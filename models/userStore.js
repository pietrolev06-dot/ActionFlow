const { createUser } = require("../auth/authHelpers");

const users = [];

function addUser(userInput) {
  const user = createUser(userInput);
  users.push(user);
  return user;
}

function getAllUsers() {
  return [...users];
}

function findUserByProvider(provider, providerUserId) {
  return users.find(
    (user) =>
      user.provider === provider && user.providerUserId === providerUserId
  ) || null;
}

function findUserById(userId) {
  return users.find((user) => user.id === userId) || null;
}

function findOrCreateUser(userInput) {
  const existingUser = findUserByProvider(
    userInput.provider,
    userInput.providerUserId
  );

  if (existingUser) {
    if (userInput.name !== undefined) {
      existingUser.name = userInput.name;
    }

    if (userInput.email !== undefined) {
      existingUser.email = userInput.email;
    }

    if (userInput.googleTokens !== undefined) {
      existingUser.googleTokens = userInput.googleTokens || existingUser.googleTokens || null;
    }

    return existingUser;
  }

  return addUser(userInput);
}

function updateUserSettings(userId, settings) {
  const user = findUserById(userId);

  if (!user) {
    return null;
  }

  if (settings.displayName !== undefined) {
    user.displayName = settings.displayName || null;
  }

  if (settings.avatarUrl !== undefined) {
    user.avatarUrl = settings.avatarUrl || null;
  }

  if (settings.theme !== undefined) {
    user.theme = settings.theme || "system";
  }

  return user;
}

function updateUserGoogleTokens(userId, googleTokens) {
  const user = findUserById(userId);

  if (!user) {
    return null;
  }

  user.googleTokens = googleTokens || null;
  return user;
}

function getUserGoogleTokens(userId) {
  const user = findUserById(userId);
  return user && user.googleTokens ? user.googleTokens : null;
}

module.exports = {
  addUser,
  findUserById,
  findUserByProvider,
  findOrCreateUser,
  getUserGoogleTokens,
  getAllUsers,
  updateUserGoogleTokens,
  updateUserSettings,
};
