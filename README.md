realm-client-browser-js
=======================

Front-end part of LoginShield SDK for direct integration into a web application.

This library integrates into the website front-end JavaScript.

# API

## loginshieldInit

Import the library. When using webpack, it might look like this:

```
import { loginshieldInit } from '@loginshield/realm-client-browser';
```

After the page loads, call `loginshieldInit`:

```
loginshieldInit({
    elementId: 'loginshield-content',
    backgroundColor: '#efefef',
    // width: '100%',
    // height: '600px',
    action: 'start',
    mode: loginMode,
    forward,
    rememberMe,
    onResult: Function,
});
```

The `elementId` is an HTML element ID where the library should render its user interface.

The `backgorundColor` is a hex RGB color value for the page background so the library's user interface
will blend with the rest of the page.

The `action` is either `"start"` or `"resume"`.

The `mode` is either `null` for a regular login, or `"link-device"` for an initial activation or access recovery.

The `onResult` is a function to handle results from the library. Here is an implementation outline:

```
function onResult(result) {
    switch (result.status) {
    case 'verify':
        // TODO: call server with { verifyToken: result.verifyToken } to complete authentication process
        break;
    case 'error':
        if (activity === 'activate-loginshield') {
            // TODO: redirect to that activity
            return;
        }
        this.loginshieldStartError = true;
        // TODO: reset login form
        break;
    case 'cancel':
        if (activity === 'activate-loginshield') {
            // TODO: redirect to that activity
            return;
        }
        // TODO: reset login form
        break;
    default:
        console.error(`onResult: unknown status ${result.status}`);
    }
},
```

# Build

```
npm run lint
npm run build
```
