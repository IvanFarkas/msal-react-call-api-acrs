const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const cors = require('cors');
const path = require('path');
const msalWrapper = require('msal-express-wrapper');
const passport = require('passport');
require('dotenv').config();
const BearerStrategy = require('passport-azure-ad').BearerStrategy;
const todolistRoutes = require('./routes/todolistRoutes');
const adminRoutes = require('./routes/adminRoutes');
const routeGuard = require('./utils/routeGuard');
const app = express();

app.set('views', path.join(__dirname, './views'));
app.set('view engine', 'ejs');
app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
app.use('/js', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));
app.use(express.static(path.join(__dirname, './public')));
app.use(methodOverride('_method'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/**
 * We need to enable CORS for client's domain in order to expose www-authenticate header in response from the web API
 */
app.use(
  cors({
    origin: process.env.API_CORS_ALLOWED_DOMAINS, // replace with client domain
    exposedHeaders: 'www-authenticate',
  })
);

/**
 * Using express-session middleware. Be sure to familiarize yourself with available options and set them as desired.
 * Visit: https://www.npmjs.com/package/express-session
 */
const sessionConfig = {
  secret: process.env.API_EXPRESS_SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set this to true on production
  },
};

if (app.get('env') === 'production') {
  /**
   * In App Service, SSL termination happens at the network load balancers, so all HTTPS requests reach your app as unencrypted HTTP requests.
   * The line below is needed for getting the correct absolute URL for redirectUri configuration.
   * For more information, visit: https://docs.microsoft.com/azure/app-service/configure-language-nodejs?pivots=platform-linux#detect-https-session
   */

  app.set('trust proxy', 1); // trust first proxy e.g. App Service
  sessionConfig.cookie.secure = true; // serve secure cookies
}

app.use(session(sessionConfig));

// =========== Initialize Passport ==============
const bearerOptions = {
  identityMetadata: `https://${process.env.API_AUTHORITY}/${process.env.API_TENANT_ID}/v2.0/.well-known/openid-configuration`,
  issuer: `https://${process.env.API_AUTHORITY}/${process.env.API_TENANT_ID}/v2.0`,
  clientID: process.env.API_CLIENT_ID,
  audience: process.env.API_CLIENT_ID, // Audience is this application
  validateIssuer: true,
  passReqToCallback: false,
  loggingLevel: 'info',
  scope: [process.env.API_API_REQUIRED_PERMISSION], // scope you set during app registration
};
const bearerStrategy = new BearerStrategy(bearerOptions, (token, done) => {
  // Send user info using the second argument
  done(null, {}, token);
});

app.use(passport.initialize());

passport.use(bearerStrategy);

// Protected api endpoints
app.use(
  '/api',
  passport.authenticate('oauth-bearer', { session: false }), // validate access tokens
  routeGuard, // Check for auth context
  todolistRoutes
);

// =========== Initialize MSAL Node Wrapper==============
const appSettings = {
  appCredentials: {
    clientId: process.env.API_CLIENT_ID,
    tenantId: process.env.API_TENANT_ID,
    clientSecret: process.env.API_CLIENT_SECRET,
  },
  authRoutes: {
    redirect: process.env.API_REDIRECT_URI, // The path component of your redirect URI
    error: '/admin/error', // The wrapper will redirect to this route in case of any error
    unauthorized: '/admin/unauthorized', // The wrapper will redirect to this route in case of unauthorized access attempt
  },
  remoteResources: {
    // Microsoft Graph beta authenticationContextClassReference endpoint.
    // For more information visit: https://docs.microsoft.com/en-us/graph/api/resources/authenticationcontextclassreference?view=graph-rest-beta
    msGraphAcrs: {
      endpoint: 'https://graph.microsoft.com/beta/identity/conditionalAccess/policies',
      scopes: ['Policy.ReadWrite.ConditionalAccess', 'Policy.Read.ConditionalAccess'],
    },
  },
};

// Instantiate the wrapper
const authProvider = new msalWrapper.AuthProvider(appSettings);

// Initialize the wrapper
app.use(authProvider.initialize());

// Pass down to the authProvider instance to use in router
app.use('/admin', adminRoutes(authProvider));

const port = process.env.API_PORT || 5000;

app.listen(port, () => {
  console.log('Listening on port ' + port);
});

module.exports = app;
