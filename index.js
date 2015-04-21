// [cp] - https://developer.chrome.com/apps/identity

var gh = (function() {
  'use strict';

  var signin_button;
  var revoke_button;
  var user_info_div;

  console.log("gh");

  var tokenFetcher = (function() {
    var clientId = 'dbd9f3596c9b44e6a04a3402324ad206';
    var clientSecret = 'EudlCHhQLOoPKqYu47RUYJqdPI2gWb1UZ8lu4qq1pHm3crz4dAK4wRgZ9vGNsYQ';
    var redirectUri = chrome.identity.getRedirectURL('provider_cb');
    var redirectRe = new RegExp(redirectUri + '[#\?](.*)');

    var access_token = null;

    return {
      getToken: function(interactive, callback) {
        console.log("tokenFetcher.getToken", access_token);
        // In case we already have an access_token cached, simply return it.
        if (access_token) {
          callback(null, access_token);
          return;
        }

        var options = {
          'interactive': interactive,
          'url': 'http://staging.ipassexam.com/auth/authorize?embed=true' +
                 '&client_id=' + clientId +
                 '&redirect_uri=' + encodeURIComponent(redirectUri)
        };
        
        console.log("About to launch WebAuthFlow", redirectUri);
        chrome.identity.launchWebAuthFlow(options, function(redirectUri) {
          console.log('launchWebAuthFlow completed', chrome.runtime.lastError, redirectUri);

          if (chrome.runtime.lastError) {
            callback(new Error(chrome.runtime.lastError));
            return;
          }

          // Upon success the response is appended to redirectUri, e.g.
          // https://{app_id}.chromiumapp.org/provider_cb#access_token={value}
          //     &refresh_token={value}
          // or:
          // https://{app_id}.chromiumapp.org/provider_cb#code={value}
          var matches = redirectUri.match(redirectRe);
          if (matches && matches.length > 1)
            handleProviderResponse(parseRedirectFragment(matches[1]));
          else
            callback(new Error('Invalid redirect URI'));
        });

        function parseRedirectFragment(fragment) {
          console.log("tokenFetcher.getToken.parseRedirectFragment", fragment);
          var pairs = fragment.split(/&/);
          var values = {};

          pairs.forEach(function(pair) {
            var nameval = pair.split(/=/);
            values[nameval[0]] = nameval[1];
          });

          return values;
        }

        function handleProviderResponse(values) {
          console.log("tokenFetcher.getToken.handleProviderResponse", values);
          if (values.hasOwnProperty('access_token'))
            setAccessToken(values.access_token);
          // If response does not have an access_token, it might have the code,
          // which can be used in exchange for token.
          else if (values.hasOwnProperty('code'))
            exchangeCodeForToken(values.code);
          else 
            callback(new Error('Neither access_token nor code avialable.'));
        }

        function exchangeCodeForToken(code) {
          console.log("tokenFetcher.getToken.exchangeCodeForToken", code);
          var xhr = new XMLHttpRequest();
          xhr.open('GET',
                   'http://staging.ipassexam.com/auth/authorize?response_type=token' +
                   '&client_id=' + clientId +
                   '&client_secret=' + clientSecret +
                   '&redirect_uri=' + redirectUri +
                   '&code=' + code);
                   
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = function () {
            // When exchanging code for token, the response comes as json, which
            // can be easily parsed to an object.
            if (this.status === 200) {
              var response = JSON.parse(this.responseText);
              console.log(response);
              if (response.hasOwnProperty('access_token')) {
                setAccessToken(response.access_token);
              } else {
                callback(new Error('Cannot obtain access_token from code.'));
              }
            } else {
              console.log('code exchange status:', this.status);
              callback(new Error('Code exchange failed'));
            }
          };
          xhr.send();
        }

        function setAccessToken(token) {
          access_token = token; 
          console.log('Setting access_token: ', access_token);
          callback(null, access_token);
        }
      },

      removeCachedToken: function(token_to_remove) {
        console.log("tokenFetcher.removeCachedToken");
        if (access_token == token_to_remove)
          access_token = null;
      }
    };
  })();

  function xhrWithAuth(method, url, interactive, callback) {
    var retry = true;
    var access_token;

    console.log('xhrWithAuth', method, url, interactive);
    getToken();

    function getToken() {
      console.log("getToken");
      tokenFetcher.getToken(interactive, function(error, token) {
        console.log('token fetch', error, token);
        if (error) {
          callback(error);
          return;
        }

        access_token = token;
        requestStart();
      });
    }

    function requestStart() {
      console.log("getToken");
      var xhr = new XMLHttpRequest();
      xhr.open(method, url);
      xhr.setRequestHeader('Authorization', 'Bearer ' + access_token);
      xhr.onload = requestComplete;
      xhr.send();
    }

    function requestComplete() {
      console.log('requestComplete', this.status, this.response);
      if ( ( this.status < 200 || this.status >=300 ) && retry) {
        retry = false;
        tokenFetcher.removeCachedToken(access_token);
        access_token = null;
        getToken();
      } else {
        callback(null, this.status, this.response);
      }
    }
  }

  function getUserInfo(interactive) {
    console.log("getUserInfo", interactive);
    xhrWithAuth('GET',
                'http://staging.ipassexam.com:80/v1/account',
                interactive,
                onUserInfoFetched);
  }

  // Functions updating the User Interface:

  function showButton(button) {
    button.style.display = 'inline';
    button.disabled = false;
  }

  function hideButton(button) {
    button.style.display = 'none';
  }

  function disableButton(button) {
    button.disabled = true;
  }

  function onUserInfoFetched(error, status, response) {
    console.log("onUserInfoFetched");
    
    if (!error && status == 200) {
      console.log("Got the following user info: " + response);
      var user_info = JSON.parse(response);
      populateUserInfo(user_info);
      hideButton(signin_button);
      showButton(revoke_button);
      fetchUserResources(user_info["repos_url"]);
    } else {
      console.log('infoFetch failed', error, status);
      showButton(signin_button);
    }
  }

  function populateUserInfo(user_info) {
    console.log("populateUserInfo");
    
    var elem = user_info_div;
    var nameElem = document.createElement('div');
    nameElem.innerHTML = "<b>Hello " + user_info.partyRoleName + "</b><br>"
    	+ "Your page is: " + user_info.uri;
    elem.appendChild(nameElem);
  }

  function fetchUserResources(repoUrl) {
    console.log("fetchUserResources");
    xhrWithAuth('GET', repoUrl, false, onUserReposFetched);
  }

  function onUserReposFetched(error, status, response) {
    console.log("onUserReposFetched");
    
    var elem = document.querySelector('#user_resources');
    elem.value='';
    if (!error && status == 200) {
      console.log("Got the following user resources:", response);
      var user_resources = JSON.parse(response);
      elem.value = response;
    } else {
      console.log('infoFetch failed', error, status);
    }
    
  }

  // Handlers for the buttons's onclick events.

  function interactiveSignIn() {
    console.log("interactiveSignIn");
    disableButton(signin_button);
    tokenFetcher.getToken(true, function(error, access_token) {
      if (error) {
        showButton(signin_button);
      } else {
        getUserInfo(true);
      }
    });
  }

  function revokeToken() {
    console.log("revokeToken");
    // We are opening the web page that allows user to revoke their token.
    window.open('http://staging.ipassexam.com/account/profile');
    // And then clear the user interface, showing the Sign in button only.
    // If the user revokes the app authorization, they will be prompted to log
    // in again. If the user dismissed the page they were presented with,
    // Sign in button will simply sign them in.
    user_info_div.textContent = '';
    hideButton(revoke_button);
    showButton(signin_button);
  }

  return {
    onload: function () {
      console.log("onload");
      
      signin_button = document.querySelector('#signin');
      signin_button.onclick = interactiveSignIn;

      revoke_button = document.querySelector('#revoke');
      revoke_button.onclick = revokeToken;

      user_info_div = document.querySelector('#user_info');

      //console.log(signin_button, revoke_button, user_info_div);

      showButton(signin_button);
      getUserInfo(true);
    }
  };
})();

window.onload = gh.onload;
