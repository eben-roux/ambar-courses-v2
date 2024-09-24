import Express from "express";
import fetch from "node-fetch"
import { engine } from 'express-handlebars';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import Session from "express-session";

const port = 8080
const app = Express()

const domains = {
  identity: process.env.DOMAIN_IDENTITY + "/api/v1/identity",
  security: process.env.DOMAIN_SECURITY + "/api/v1/security"
}

const endpoints = {
  "request-primary-email-change": domains.identity + "/user/request-primary-email-change",
  "sign-up": domains.identity + "/user/sign-up",
  "verify-primary-email": domains.identity + "/user/verify-primary-email",
  "refresh-token": domains.security + "/session/refresh-token",
  "sign-in": domains.security + "/session/sign-in",
  "sign-out": domains.security + "/session/sign-out"
}

// Accept JSON bodies
app.use(Express.json())
app.use(Express.urlencoded({ extended: true }));

// Handle sessions
app.use(Session({
  secret: 'keyboard cat',
  resave: false,
  saveUninitialized: true
}))

// Middleware to ensure authentication.
function authenticated(req, res, next) {
  if (req.session.token) {
    return next();
  }
  return res.redirect("/sign-in");
}

// Middleware to ensure user is not authenticated.
function unauthenticated(req, res, next) {
  if (!req.session.token) {
    return next();
  }
  return res.redirect("/sign-in");
}

function authenticate(req, token) {
  req.session.token = token;
}

function unauthenticate(req) {
  delete req.session.token;
}

function render(template, layout = false) {
  return function (_, res) {
    return res.render(template, { layout });
  }
}
// Setup templating
const __dirname = dirname(fileURLToPath(import.meta.url));
app.engine('handlebars', engine());
app.set('view engine', 'handlebars');
app.set('views', `${__dirname}/views`);

app.get('/sign-in', unauthenticated, render("sign-in"))
app.get('/sign-up', unauthenticated, render("sign-up"))
app.get('/sign-up-success', unauthenticated, render("sign-up-success"))
app.get('/user/details', authenticated, routeUserDetails)
app.get('/logout', authenticated, routeLogout)
app.get('/', authenticated, render("home", "main"))
app.get('/verify-email', unauthenticated, routeVerifyEmail);
app.post('/sign-in', unauthenticated, routeSignIn);
app.post('/sign-up', unauthenticated,  routeSignUp);

// Default metadata for requests.
const metadata = {
  environment: "browser",
  devicePlatform: "unknown",
  deviceModel: "unknown",
  deviceOSVersion: "unknown",
  deviceOrientation: "unknown"
};

function routeUserDetails(req, res) {
  res.render("details", {
    layout: "main",
    locals: {
      email: req.session.email
    }
  });
}

async function routeVerifyEmail(req,res) {
  const verificationCode = req.query.code;
  const contents = { verificationCode, metadata };
  const response = await fetch(endpoints["verify-primary-email"], {
      method: "POST",
      body: JSON.stringify(contents, null, 2),
      headers: {'Content-Type': 'application/json'}
  });
  const r = await response.json();

  if (!response.ok) {
    const error = getError(r);
    res.render("verify-email", {
      layout: false,
      error,
    });
    return;
  }

  res.render(`verify-email`, { layout: false })
}

async function routeSignIn(req, res) {
  const { email, password } = req.body;

  // temporary hack
  {
    req.session.token = "temp token"
    req.session.email = email;
    res.redirect("/");
    return;
  }

  const contents = {
    withUsernameOrEmail: email,
    withPassword: password,
    byDeviceLabel: "desktop",
    metadata
  }
  const response = await fetch(endpoints["sign-in"], {
      method: "POST",
      body: JSON.stringify(contents, null, 2),
      headers: {'Content-Type': 'application/json'}
  });

  const r = await response.json();
  if (!response.ok) {
    const rawError = getError(r);
    const error =
      rawError == "Security_Session_SignIn_UserNotFound"
      ? "Invalid email or password"
      : rawError

    res.render("sign-in", {
      layout: false,
      error,
    });
    return;
  }

  const token = r.sessionTokenCreated;
  if (typeof token === "string") {
    authenticate(req, token);
    res.redirect("/");
    return;
  } else {
    res.send(`Failure. ${JSON.stringify(r)}`);
  }
};

// Parse error from a failure response
function getError({ errors, errorIdentifier, errorMessage }) {
  return (errors.length > 0 && errorMessage.length > 0)
    ? `${errorMessage}: ${errors.join(". ")}`
    : errorMessage.length > 0
    ? errorMessage
    : errors.length > 0
    ? errors[0]
    : errorIdentifier
}

async function routeSignUp(req, res) {
  const { email, password, username } = req.body;
  const contents = {
    primaryEmail: email,
    password: password,
    username: username,
    termsOfUseAccepted: true,
    metadata
  }

  const response = await fetch(endpoints["sign-up"], {
      method: "POST",
      body: JSON.stringify(contents, null, 2),
      headers: {'Content-Type': 'application/json'}
  });

  const r = await response.json()

  if (!response.ok) {
    const rawError = getError(r);
    const error =
      rawError == "Identity_User_SignUp_InvalidPassword"
      ? "Invalid password. A password must have between 10 and 64 characters and contain a number, an upper case letter, a lower case letter and a special character."
      : rawError;

    res.render("sign-up", {
      layout: false,
      error,
      username,
      email,
    });
    return;
  }

  if (typeof r.userId === "string") {
    res.redirect(`/sign-up-success`);
    return;
  }

  res.send(`Unexpected response. ${JSON.stringify(r)}`);
}

async function routeLogout(req, res) {
  unauthenticate(req);
  const contents = { metadata }

  const response = await fetch(endpoints["sign-out"], {
      method: "POST",
      body: JSON.stringify(contents, null, 2),
      headers: {'Content-Type': 'application/json'}
  });

  const r = await response.json()

  if (!response.ok) {
    const error = getError(r);
    errorPage(res, error);
    return;
  }

  res.redirect("/sign-in");
}

function errorPage(res, error) {
  res.send(error);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})

