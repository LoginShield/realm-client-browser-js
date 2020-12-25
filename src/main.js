/*!
Copyright (C) 2019 Cryptium Corporation. All rights reserved.
*/
/* eslint-disable no-console */

/*
This script runs in the iframe loaded by the enterprise website.
*/

console.log('loginshield-realm-client: loaded enterprise-client-browser-js');

let iframeOrigin = null; // url, e.g. 'https://loginshield.com'
let isIframeHidden = false;
let loginshieldIframeHelloTimer = null;
let isHelloDone = false;
let loginshieldForwardURL = null; // url
let loginshieldAction = null; // string 'start' or 'resume'
let loginshieldMode = null; // null or 'link-device' for new user or new device
let loginshieldRememberMe = null; // boolean
let onResult = null; // application-provided callback function
/*
let loginshieldLoginCallback = null;
let loginshieldErrorCallback = null;
let loginshieldCancelCallback = null;
*/
let iframe = null;
let container = null; // only initialized when isIframeHidden === true
let isCssInit = false;

function initCss() {
    if (isCssInit) { return; }
    const css = `
.loginshield-container {
    background-color: #ffffff;
    width: 400px;
    height: 400px;
}
.loginshield-progress-indicator {
    border: 4px solid #dadada;
    border-top: 4px solid #2196f3;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: loginshield-progress-indicator-spin 1.0s linear infinite;
    margin: auto;
    position: absolute;
    top:0;
    left:0;
    right:0;
    bottom:0;
}
.loginshield-display-image {
    display: block;
    width: 300px;
    height: 300px;
    margin: auto;
    position: absolute;
    top:0;
    left:0;
    right:0;
    bottom:0;
}
@keyframes loginshield-progress-indicator-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
`;
    const style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    if (style.styleSheet) { // IE
        style.styleSheet.cssText = css;
    } else { // the world
        style.appendChild(document.createTextNode(css));
    }
    const head = document.getElementsByTagName('head')[0];
    head.appendChild(style);
    isCssInit = true;
}

// precondition: container initialized (implies isIframeHidden)
function emptyContainer() {
    while (container.lastChild) {
        container.removeChild(container.lastChild);
    }
}

// precondition: container initialized (implies isIframeHidden)
function displayIndefiniteProgressIndicator() {
    emptyContainer();
    const div = document.createElement('div');
    div.setAttribute('class', 'loginshield-progress-indicator');
    container.appendChild(div);
}

function loginshieldIframePostMessage(message) {
    if (iframe) {
        iframe.contentWindow.postMessage(message, iframeOrigin);
        /*
        Specifying the iframe's origin (e.g. https://loginshield.com) should limit the
        message only to an iframe that was loaded from that domain, but sometimes* we see
        this error in the browser:
        Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('https://loginshield.com') does not match the recipient window's origin ('https://example.com').
        The error seems to happen when navigating to another page and then returning to the
        login page when the javascript was already initialized from a prior navigation to the login
        page, but the iframe source is reloaded so the communication needs to wait until the hello
        is done.
        */
    } else {
        console.error('loginshield-realm-client: iframe not found by id: loginshield-enterprise');
    }
}
function loginshieldStartLogin() {
    // get the client token, to access stored gateway information for this (client, domain)
    // combination (the domain is already implied by the browser's localStorage implementation,
    // which provides a separate storage area for each domain);  resetting this token will
    // cause the user's authenticator to display a safety notice until the new gateway public
    // key becomes trusted
    const clientToken = localStorage.getItem('loginshield.client.token');

    // resetting the rememberMe token will cause a QR code to be displayed instead of a
    // push notification; however, even when rememberMe is disabled the token must be stored
    // temporarily in case the authenticator displays a safety notice and the user follows
    // the email link, because without it the resume action will fail; so when rememberMe is
    // disabled we clear the rememberMeToken when login is done, to affect the next login
    // (and if the login is incomplete and someone else tries to login as the same user, the
    // QR code will be displayed anyway because the push notification is only allowed after
    // one successful login)
    const rememberMeToken = localStorage.getItem('loginshield.rememberMe.token');

    console.log(`loginshield-realm-client: rememberMeToken ${rememberMeToken}`);
    console.log(`loginshield-realm-client: clientToken ${clientToken}`);

    // send the challenge to iframe
    loginshieldIframePostMessage({
        forward: loginshieldForwardURL,
        action: loginshieldAction,
        mode: loginshieldMode,
        clientToken,
        rememberMeToken,
        hidden: isIframeHidden, // when true, iframe will send postMessage with an image to display, instead of trying to display it inside the iframe
    });
}
function handleMessage(e) {
    const dataJson = JSON.stringify(e.data);
    console.log(`loginshield-realm-client: parent handleMessage origin ${e.origin} data ${dataJson}`);
    // skip messages not from the loginshield iframe
    if (e.origin !== iframeOrigin) {
        return;
    }
    if (e.data === 'hello') {
        // iframe replied to our hello
        if (isHelloDone) {
            // only accept one reply to avoid starting two or more concurrent login requests
            console.log('loginshield-realm-client: hello already done');
            return;
        }
        console.log('loginshield-realm-client: hello done, starting login request');
        isHelloDone = true;
        loginshieldStartLogin();
    }
    if (typeof e.data === 'object') {
        if (e.data.clientToken) {
            console.log('loginshield-realm-client: storing new client token');
            localStorage.setItem('loginshield.client.token', e.data.clientToken);
        }
        if (e.data.rememberMeToken) {
            // NOTE: when we receive the token, we must store it in case the login request involves
            // a redirect via email; when login is completed we will remove the token again
            // (look for localStorage.removeItem in the verifyToken section below)
            console.log('loginshield-realm-client: storing new rememberMe token');
            localStorage.setItem('loginshield.rememberMe.token', e.data.rememberMeToken);
        }
        if (e.data.qrcodeImageUri && isIframeHidden) {
            emptyContainer();
            // display the QR code
            const image = document.createElement('img');
            image.setAttribute('class', 'loginshield-display-image');
            image.setAttribute('src', e.data.qrcodeImageUri);
            container.appendChild(image);
        }
        if (e.data.verifyToken) {
            console.log(`loginshield-realm-client: received verifyToken from iframe; rememberMe: ${loginshieldRememberMe}`);
            if (!loginshieldRememberMe) {
                // if rememberMe is disabled, protect the user's privacy by removing the token,
                // which will enforce the setting on the next login
                localStorage.removeItem('loginshield.rememberMe.token');
            }

            if (typeof onResult === 'function') {
                onResult({ status: 'verify', verifyToken: e.data.verifyToken });
            }
        }
        if (e.data.error) {
            if (typeof onResult === 'function') {
                onResult({ status: 'error', error: e.data.error });
            }
        }
        if (e.data.status === 'cancel') {
            if (typeof onResult === 'function') {
                onResult({ status: 'cancel' });
            }
        }
    }
}

function loginshieldIframeCheckLoaded() {
    if (loginshieldIframeHelloTimer) {
        clearTimeout(loginshieldIframeHelloTimer);
        loginshieldIframeHelloTimer = null;
    }
    if (isHelloDone) {
        console.log('loginshield-realm-client: hello is already done');
        return;
    }
    loginshieldIframeHelloTimer = setTimeout(loginshieldIframeCheckLoaded, 500);
    console.log('loginshield-realm-client: sending hello to iframe'); //  ${Date.now()}
    loginshieldIframePostMessage('hello');
}
function removeElement(elementId) {
    let element;
    do {
        console.log(`loginshield-realm-client: removing ${elementId}`);
        element = document.getElementById(elementId);
        if (element) {
            console.log(`loginshield-realm-client: found ${elementId}`);
            element.parentNode.removeChild(element);
            console.log(`loginshield-realm-client: removed ${elementId}`);
        }
    } while (element);
}

// input can be a valid css name like 'black' or rgb hex
// anything that looks like a valid input will be allowed
function getBackgroundColor(input) {
    const WHITE = '#ffffff';
    if (typeof input === 'string' && input.length > 0) {
        const regex = /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^[a-z-]{1,24}$/i;
        const found = input.match(regex);
        if (found && found.length === 1) {
            return found[0];
        }
    }
    return WHITE;
}

function getWidth(input) {
    if (typeof input === 'string' && input.endsWith('%')) {
        const percent = parseInt(input, 10);
        if (percent < 0 || percent > 100) {
            return '100%';
        }
        return input;
    }
    if (typeof input === 'string' && input.endsWith('px')) {
        const pixels = parseInt(input, 10);
        if (pixels < 0) {
            return '100%';
        }
        return input;
    }
    if (typeof input === 'number' && input >= 0) {
        return input;
    }
    return '100%';
}

function getHeight(input) {
    if (typeof input === 'string' && input.endsWith('%')) {
        const percent = parseInt(input, 10);
        if (percent < 0 || percent > 100) {
            return '100%';
        }
        return input;
    }
    if (typeof input === 'string' && input.endsWith('px')) {
        const pixels = parseInt(input, 10);
        if (pixels < 0) {
            return '100%';
        }
        return input;
    }
    if (typeof input === 'number' && input >= 0) {
        return input;
    }
    return '100%';
}

function getOriginFromURL(input) {
    if (typeof URL === 'function') {
        // modern browser
        const url = new URL(input);
        return url.origin;
    }

    // should be supported by all browsers
    const a = document.createElement('a');
    a.href = input;
    return a.origin;
}

/*
This function generates an iframe element and appends it to the current document.
The iframe loads an html page from LoginShield that contains a lightweight gateway
client.
*/
export function loginshieldInit({
    elementId, // the iframe will be inserted as a child of '#elementId'
    forward, // url to loginshield interaction, required for start login and resume login
    action, // string 'start' or 'resume'
    mode, // string 'link-device' or null
    rememberMe, // boolean or null (default false)
    onResult: onResultFunction, // application-provided callback
    /*
    onLogin, // function, callback when login is ready to be verified (will be provided the `verifyToken`)
    onError, // function, callback when login fails
    onCancel, // function, callback when login is cancelled
    */
    backgroundColor = '#ffffff',
    width = '100%',
    height = '100%',
    hidden = false,
}) {
    console.log('loginshield-realm-client: init');
    loginshieldForwardURL = forward;
    loginshieldAction = action;
    loginshieldMode = mode;
    loginshieldRememberMe = !!rememberMe; // null or empty string or false -> false; other non-empty value -> true
    console.log(`loginshield-realm-client: init: rememberMe: ${loginshieldRememberMe}`);

    // if we are starting a new login request and rememberMe is false, clear the
    // rememberMeToken to ensure the user gets a QR code
    if (action === 'start' && !loginshieldRememberMe) {
        console.log('loginshield-realm-client: action start and !rememberMe, removing token');
        localStorage.removeItem('loginshield.rememberMe.token');
    }

    iframeOrigin = getOriginFromURL(forward);
    console.log(`loginshield-realm-client: iframe origin: ${iframeOrigin}`);

    isIframeHidden = hidden;
    onResult = onResultFunction;
    /*
    loginshieldLoginCallback = onLogin;
    loginshieldErrorCallback = onError;
    loginshieldCancelCallback = onCancel;
    */
    // remove iframe if already on page
    removeElement('loginshield-enterprise');
    // initialize the display
    const element = document.getElementById(elementId);
    // check the optional background color setting for the iframe
    const backgroundColorParam = getBackgroundColor(backgroundColor);
    const widthParam = getWidth(width);
    const heightParam = getHeight(height);
    const timestamp = Date.now(); // force browser to reload index.html without using cache; then if index.html has not changed it will point to the same js and css files and the browser can use cache for those
    // create the iframe
    iframe = document.createElement('iframe'); // iframe = document.getElementById('loginshield-enterprise');
    iframe.setAttribute('id', 'loginshield-enterprise');
    iframe.setAttribute('src', `${iframeOrigin}/iframe/login/index.html?background-color=${encodeURIComponent(backgroundColorParam)}&width=${encodeURIComponent(widthParam)}&height=${encodeURIComponent(heightParam)}&t=${encodeURIComponent(timestamp)}`);
    if (isIframeHidden) {
        // create the container for dynamic content like QR code, since the hidden iframe would not be displaying it
        container = document.createElement('div'); // container = document.getElementById('loginshield-container');
        container.setAttribute('class', 'loginshield-container');
        element.appendChild(container);
        // add css if not already added
        initCss();
        // display indefinite progress indicator
        displayIndefiniteProgressIndicator();
        // make the iframe as small as possible (cannot use zero because then some browsers will not render it at all, and postMessage will not work)
        iframe.setAttribute('height', '1');
        iframe.setAttribute('width', '1');
    } else {
        // NOTE: progress indicator will be shown inside the iframe
        iframe.setAttribute('height', heightParam);
        iframe.setAttribute('width', widthParam);
    }
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    element.appendChild(iframe);
    // setup communication with iframe
    if (window.addEventListener) {
        window.addEventListener('message', handleMessage, false);
    } else if (window.attachEvent) { // ie8
        window.attachEvent('onmessage', handleMessage);
    }
    isHelloDone = false;
    setTimeout(loginshieldIframeCheckLoaded, 100);
}
