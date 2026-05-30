const { buildSessionUser } = require("./authHelpers");
const { findUserById } = require("../models/userStore");

function attachCurrentUser(req, res, next) {
  const sessionUser = req.session && req.session.user ? req.session.user : null;

  if (sessionUser && sessionUser.id) {
    const persistedUser = findUserById(sessionUser.id);

    if (persistedUser) {
      req.session.user = buildSessionUser(persistedUser);
      req.currentUser = req.session.user;
      return next();
    }
  }

  req.currentUser = sessionUser;
  next();
}

module.exports = {
  attachCurrentUser,
};
