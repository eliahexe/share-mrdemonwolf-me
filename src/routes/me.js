const express = require('express');
const router = express.Router();
const gravatar = require('gravatar');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const md5 = require('js-md5');
const Key = require('../models/key');
const User = require('../models/user');
const Upload = require('../models/upload');
const userUploadsPerPage = require('./utils/user/uploadsPerPage');;
const deleteUpload = require('./utils/deleteUpload');

/**
 * @route /me
 * @method GET
 * @description Displays account.
 * @access Private
*/
router.get('/', (req, res) => {
  res.render('me/index', {
    title: 'Edit account',
  });
});

/**
 * @route /me
 * @method PATCH
 * @description Updates account details.
 * @access Private
*/
router.patch('/', (req, res) => {
  let error = {};
  let username = req.body.username.toString();
  const email = req.body.email.toString().toLowerCase();
  const newPassword = req.body.newPassword.toString();
  const oldPassword = req.body.oldPassword.toString();
  const confirmNewPassword = req.body.confirmNewPassword.toString();
  const avatar = gravatar.url(email, {
    s: '100',
    r: 'x',
    d: 'retro'
  }, true);

  let updatedUser = {
    username,
    avatar
  }

  // Check if empty
  // Username
  if (!username) { error.username = 'Please enter your username.' };
  if (req.user.streamerMode) {
    updatedUser.email = req.user.email;
  } else {
    // Email
    // Check if email is vaid
    if (!email) { error.email = 'Please enter your email.' };
    if (!validator.isEmail(email)) { error.email = 'Email must be vaild (Example someone@example.com)' };
  }
  // Password
  if (newPassword) {

    if (!confirmNewPassword) { error.confirmNewPassword = 'Must comfirm password' };
    if (!validator.isLength(newPassword, {
      minimum: 8
    })) {
      error.password = 'Password must be at least 8 characters long. '
    }
    if (newPassword !== confirmNewPassword) { error.confirmNewPassword = 'Both passowrds must match.' };
    if (newPassword === oldPassword) { error.oldPassword = "Can't be the same as the old password" };
  }
  // Check if passoword and comfirm password are the same.
  // Check password length
  if (JSON.stringify(error) === '{}') {
    username = username.toLowerCase();



    User.findByIdAndUpdate(req.user.id, updatedUser, (err, user) => {

      if (err) {
        if (err.code === 11000) {
          error.username = 'Username has already been taked.'
        }
        req.flash('error', error);
        res.redirect('/me');
        return;
      }
      if (newPassword) {

        user.changePassword(oldPassword, newPassword, (err, changedPassword) => {
          if (err) {
            if (err.name === 'IncorrectPasswordError') {
              error.oldPassword = 'Wrong current password.'
              req.flash('error', error);
              res.redirect('/me');
              return;
            }
          }
          user.passwordChangedIP = req.clientIp;
          user.passwordChanged = Date.now();
          user.save();
        });
        req.flash('success', 'Your password has been changed.  Please relogin.');
        req.logout();
        res.redirect('/login');
        return;
      };
      if (req.body.streamerMode) {
        user.streamerMode = true
        user.save();
      } else {
        user.streamerMode = undefined;
        user.save();
      };
      req.flash('success', 'Your account has been succesfuly updated.');
      res.redirect('/me');
    })
  } else {
    req.flash('error', error);
    res.redirect('/me')
  };
});

/**
 * @route /me/keys
 * @method GET
 * @description Diplays API Keys
 * @access Private
*/
router.get('/keys', (req, res) => {
  Key.find({ 'user': { id: req.user._id } }, (err, keys) => {
    res.render('me/keys', {
      title: 'Manage Keys',
      keys,
    });
  });
});

/**
 * @route /me/keys
 * @method POST
 * @description Creates a API Key
 * @access Private
*/
router.get('/keys/create', (req, res) => {
  let token = jwt.sign({
  }, process.env.API_SECRET, {
      issuer: process.env.TITLE,
      subject: req.user._id.toString()
    });
  let tokenHash = md5(token);
  const newKey = {
    user: {
      id: req.user.id
    },
    hash: tokenHash,
  }
  Key.create(newKey, (err, key) => {
    req.flash('info', token);
    res.redirect('/me/keys');
  });
});

/**
 * @route /me/keys
 * @method POST
 * @description Removes API Key
 * @access Private
*/
router.delete('/keys/:key', (req, res) => {
  Key.findByIdAndRemove(req.params.key, (err, key) => {
    if (err) {
      req.flash('error', 'Error in removing API Key');
      return res.redirect('/me/keys')
    }
    req.flash('success', 'API Key removed');
    res.redirect('/me/keys')
  });
});

/**
 * @route /me/uploads
 * @method GET
 * @description Displays uploaded stuff
 * @access Private
*/
router.get('/uploads', async (req, res) => {
  let page = 1;
  const uploads = await (userUploadsPerPage(req, res, page, req.user.id, 10));
  res.render('me/uploads', {
    title: `Manage Uploads`,
    uploads: uploads.data,
    current: page,
    // Count/limit
    pages: Math.ceil(uploads.count / 10),
  });
});

router.get('/uploads/:page', async (req, res) => {
  let page = req.params.page || 1;
  if (page === '0') { return res.redirect('/me/uploads') }
  const uploads = await (userUploadsPerPage(req, res, page, req.user.id, 10));
  res.render('me/uploads', {
    title: `Manage Uploads`,
    uploads: uploads.data,
    current: page,
    // Count/limit
    pages: Math.ceil(uploads.count / 10),
  });
});

/**
 * @route /me/uploads/id
 * @method delete
 * @description Remove uploaded file
 * @param type name
 * @access Private
*/
router.delete('/uploads/:id', (req, res) => {
  const fileName = req.query.name;

  deleteUpload.file(fileName, err => {
    if (err) {
      req.flash('error', `Could not remove that file.  Please try again.`);
      res.redirect('back');
    } else {
      deleteUpload.database(fileName)
      req.flash('success', `Removed ${fileName}`);
      res.redirect('back');
    };
  });


});

/**
 * @route /me/gallery
 * @method GET
 * @description Displays images in a gallery fomate
 * @access Private
*/
router.get('/gallery', async (req, res) => {
  const gallery = (await Upload.find({ 'uploader': req.user._id, 'isImage': true }).sort({ createdAt: -1 }));
  res.render('me/gallery', {
    title: 'Image Gallery',
    gallery,
  });
});

/**
 * @route /me/delete
 * @method GET
 * @description Delete Account
 * @access Private
*/
router.get('/delete', (req, res) => {
  Upload.find({ 'uploader': req.user.id }, (err, file) => {
    file.map(file => {
      deleteUpload.file(file.fileName, err => {
        if (err) {
          deleteErrors.file += 1;
        } else {
          deleteUpload.database(file.fileName, err => {
            if (err) {
              deleteErrors.db += 1;
            }
          });
        }
      });
    });
  });
  // Check there is any erros and show a error message/

  Key.deleteMany({ 'user': { id: req.user.id } });
  User.findByIdAndDelete(req.user.id);
  res.redirect('/');
});

/**
 * @route /me/uploads/delete/all
 * @method GET
 * @description Remove all images
 * @access Private
*/
router.get('/uploads/delete/all', async (req, res) => {
  let deleteErrors = {
    file: 0,
    db: 0,
  };
  // Find all uploads by the user
  uploads = (await Upload.find({ 'uploader': req.user.id }));   // If no uploads are found then show a error message
  if (uploads.length === 0) {
    req.flash('error', 'You must upload before you can delete.');
    res.redirect('/me/uploads');
    return;
  };

  await uploads.map(file => {
    deleteUpload.file(file.fileName, err => {
      if (err) {
        deleteErrors.file += 1;
      } else {
        deleteUpload.database(file.fileName, err => {
          if (err) {
            deleteErrors.db += 1;
          }
        });
      }
    });
  });
  setTimeout(() => {
    if (deleteErrors.file > 0 || deleteErrors.db > 0) {
      req.flash('error', `Not all files could be removed.  Please try again.`);
      res.redirect('/me/uploads');
      return;
    }
    // All uploads has been removed
    req.flash('success', 'All your uploads has been deleted.');
    res.redirect('/me/uploads');
  });
});

module.exports = router;
