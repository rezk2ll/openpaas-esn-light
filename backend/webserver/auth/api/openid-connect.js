/**
 * OpenID Connect Strategy based on passport HTTP bearer strategy:
 * - Get the accessToken from passport
 * - Get the user information from OpenID Connect Auth provider
 * - If user information is not found, do not send back error so that other startegies can be traversed
 */

const { promisify } = require('util');
const { parseOneAddress } = require('email-addresses');
const logger = require('../../../core/logger');
const oidc = require('../../../core/auth/openid-connect');
const userModule = require('../../../core/user');
const domainModule = require('../../../core/domain');
const BearerStrategy = require('passport-http-bearer').Strategy;

module.exports = {
  name: 'openid-connect',
  strategy: new BearerStrategy(oidcCallback),
  oidcCallback
};

function oidcCallback(accessToken, done) {
  logger.debug('API Auth - OIDC : Authenticating user for accessToken', accessToken);

  oidc.getUserInfo(accessToken)
    .then(userInfo => {
      logger.debug('API Auth - OIDC : UserInfo from OIDC server', userInfo);
      if (!userInfo.email) {
        throw new Error('API Auth - OIDC : userinfo must contain required "email" field');
      }

      return userInfo;
    })
    .then(userInfo => buildProfile(userInfo))
    .then(profile => findOrCreate(profile))
    .then(user => {
      if (!user) {
        throw new Error('API Auth - OIDC : No user found nor created from accessToken');
      }

      done(null, user);
    })
    .catch(err => {
      logger.error('API Auth - OIDC : Error while authenticating user from OpenID Connect accessToken', err);
      done(null, false, { message: `Cannot validate OpenID Connect accessToken. ${err}` });
    });
}

function findOrCreate(profile) {
  const findByEmail = promisify(userModule.findByEmail);
  const provisionUser = promisify(userModule.provisionUser);

  return findByEmail(profile.email)
    .then(user => (user ? Promise.resolve(user) : provisionUser(userModule.translate(user, profile))));
}

function buildProfile(userInfo) {
  // TBD: Domain is defined from user email address TLD
  // In some providers, it is defined in clientId suffix
  const domainName = parseOneAddress(userInfo.email).domain;

  return getDomainByName(domainName).then(domainId => ({
    email: userInfo.email,
    username: userInfo.email,
    domainId
  }));
}

function getDomainByName(domainName) {
  return domainModule.getByName(domainName)
    .then(domain => (domain && domain.id))
    .then(domainId => {
      if (!domainId) {
        throw new Error(`API Auth - OIDC : Cannot find the domain with name "${domainName}"`);
      }

      return domainId;
    });
}
