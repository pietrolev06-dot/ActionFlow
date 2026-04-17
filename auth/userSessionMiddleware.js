function attachCurrentUser(req, res, next) {
  req.currentUser = req.session && req.session.user ? req.session.user : null;
  next();
}

module.exports = {
  attachCurrentUser,
};
