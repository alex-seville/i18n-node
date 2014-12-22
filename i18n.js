/*jslint nomen: true, undef: true, sloppy: true, white: true, stupid: true, passfail: false, node: true, indent: 2 */
/**
 * @author      Created by Marcus Spiegel <marcus.spiegel@gmail.com> on 2011-03-25.
 * @link        https://github.com/mashpie/i18n-node
 * @license     http://opensource.org/licenses/MIT
 *
 * @version     0.3.7
 */

// dependencies
var vsprintf = require('sprintf').vsprintf,
    sprintf = require('sprintf').sprintf,
    fs = require('fs'),
    url = require('url'),
    path = require('path'),
    locales = {},
    defaultLocale = 'en',
    updateFiles = true,
    cookiename = null,
    debug = false,
    verbose = false,
    extension = '.js',
    readFcn, writeFcn,
    directory = './locales';

// public exports
var i18n = exports;

i18n.version = '0.3.7';

i18n.configure = function (opt) {
  // you may register helpers in global scope, up to you
  if (typeof opt.register === 'object') {
    opt.register.__ = i18n.__;
    opt.register.__n = i18n.__n;
    opt.register.getLocale = i18n.getLocale;
  }

  // sets a custom cookie name to parse locale settings from
  if (typeof opt.cookie === 'string') {
    cookiename = opt.cookie;
  }

  // where to store json files
  if (typeof opt.directory === 'string') {
    directory = opt.directory;
  } else {
    directory = './locales';
  }

  // write new locale information to disk
  if (typeof opt.updateFiles === 'boolean') {
    updateFiles = opt.updateFiles;
  }

  if (typeof opt.readFcn === "function") {
    readFcn = opt.readFcn;
  }
  if (typeof opt.writeFcn === "function") {
    writeFcn = opt.writeFcn;
  }

  // where to store json files
  if (typeof opt.extension === 'string') {
    extension = opt.extension;
  }

  // enabled some debug output
  if (opt.debug) {
    debug = opt.debug;
  }

  // implicitly read all locales
  if (typeof opt.locales === 'object') {
    opt.locales.forEach(function (l) {
      read(l);
    });
  }
};

i18n.init = function i18nInit(request, response, next) {
  if (typeof request === 'object') {
    guessLanguage(request);
  }
  if (typeof next === 'function') {
    next();
  }
};

function parseArguments(arr) {
  var a = Array.prototype.slice.call(arr);
 
  return a.filter(function (el) {
    if (typeof el === 'string') {
      return true;
    }
  }).map(function (el) {
    try {
      return JSON.parse(el);
    } catch (e) {
      // JS error is raised that means string is not JSON
      return el;
    }
  });
}

i18n.__ = function (phrase) {
  var locale, msg;
  if (this && this.scope) {
    locale = this.scope.locale;
  }
  if (this && this.locale) {
    locale = this.locale;
  }
  phrase = translate(locale, phrase);

  var regexp = /(\%\%\w+\%\%)/g;
  var submatches = phrase.match(regexp);
  if (submatches) {
    for (var i = 0; i < submatches.length; i++) {
      var sm = submatches[i];
      phrase = phrase.replace(sm, i18n.__(sm.slice(2, -2)));
    }
  }

  var re = /\%([a-zA-Z]+)\%/g;

  phrase = phrase.replace(re, "%($1)s");
  re = /(\%\d)/g;
  phrase = phrase.replace(re, "$1$$s");
  //msg = translate(locale, phrase);

  var args = parseArguments(arguments).slice(1);
 
 
  if (args.length > 0) {
    phrase = vsprintf.call(null, phrase, args);
  } 
 

  return phrase;
};

i18n.__n = function (phrase, count) {
  var locale, msg;

  // get locale from scope (deprecated) or object
  if (this && this.scope) {
    locale = this.scope.locale;
  }
  if (this && this.locale) {
    locale = this.locale;
  }

  phrase = translate(locale, phrase);
 

  var regexp = /(\%\%\w+\%\%)/g;
  var submatches = phrase.match(regexp);
  if (submatches) {
    for (var j = 0; j < submatches.length; j++) {
      var sm = submatches[j];
     
      var newVal =  i18n.__(sm.slice(2, -2));
     
      phrase = phrase.replace(sm, newVal);
    }
  }


  var re = /\%([a-zA-Z]+)\%/g;

  phrase = phrase.replace(re, "%($1)s");
  re = /(\%[0-9]+\%)/g;
  //phrase = phrase.replace(re, "%$1$$s");
  var digitmatches = phrase.match(re);
  if (digitmatches) {
    for (var k = 0; k < digitmatches.length; k++) {
      var sm = digitmatches[k];
      phrase = phrase.replace(sm,"%"+(k+1)+"$s");
    }
  }

  var singular, plural, none;
  var params = phrase.split("|");
  for (var i = 0; i < params.length; i++) {
    var currParam = params[i];
    var num = currParam.slice(1, currParam.indexOf("]"));
    if (num === "1") {
      singular = currParam.slice(currParam.indexOf("]") + 1);
    } else if (num !== "0") {
      plural = currParam.slice(currParam.indexOf("]") + 1);
    } else {
      none = currParam.slice(currParam.indexOf("]") + 1);
    }
  }
  // get translation
  msg = {
    other: plural,
    one: singular,
    none: none
  };

  // parse translation and replace all digets '%d' by `count`
  // this also replaces extra strings '%%s' to parseble '%s' for next step
  // simplest 2 form implementation of plural, like https://developer.mozilla.org/en/docs/Localization_and_Plurals#Plural_rule_.231_.282_forms.29
  if (parseInt(count, 10) > 1) {
    msg = vsprintf(msg.other, [parseInt(count, 10) ]);
  } else if (parseInt(count, 10)  === 1)  {
    msg = vsprintf(msg.one, [1]);
  } else {
    msg = msg.none;
  }
  // if we have extra arguments with strings to get replaced,
  // an additional substition injects those strings afterwards
  if (arguments.length > 3) {
    msg = vsprintf(msg, Array.prototype.slice.call(parseArguments(arguments), 3));
  }

  return msg;
};

// either gets called like
// setLocale('en') or like
// setLocale(req, 'en')
i18n.setLocale = function (arg1, arg2) {
  var target_locale = arg1,
      request;

  if (arg2 && locales[arg2]) {
    request = arg1;
    target_locale = arg2;
  }

  if (locales[target_locale]) {
    if (request === undefined) {
      defaultLocale = target_locale;
    }
    else {
      request.locale = target_locale;
    }
  }
  return i18n.getLocale(request);
};

i18n.getLocale = function (request) {
  if (request === undefined) {
    return defaultLocale;
  }
  return request.locale;
};

i18n.overrideLocaleFromQuery = function (req) {
  if (req === null) {
    return;
  }
  var urlObj = url.parse(req.url, true);
  if (urlObj.query.locale) {
    if (debug) {
      console.log("Overriding locale from query: " + urlObj.query.locale);
    }
    i18n.setLocale(req, urlObj.query.locale.toLowerCase());
  }
};

// ===================
// = private methods =
// ===================
// guess language setting based on http headers

function guessLanguage(request) {
  if (typeof request === 'object') {
    var language_header = request.headers['accept-language'],
        languages = [],
        regions = [];

    request.languages = [defaultLocale];
    request.regions = [defaultLocale];
    request.language = defaultLocale;
    request.region = defaultLocale;

    if (language_header) {
      language_header.split(',').forEach(function (l) {
        var header = l.split(';', 1)[0],
            lr = header.split('-', 2);
        if (lr[0]) {
          languages.push(lr[0].toLowerCase());
        }
        if (lr[1]) {
          regions.push(lr[1].toLowerCase());
        }
      });

      if (languages.length > 0) {
        request.languages = languages;
        request.language = languages[0];
      }

      if (regions.length > 0) {
        request.regions = regions;
        request.region = regions[0];
      }
    }

    // setting the language by cookie
    if (cookiename && request.cookies && request.cookies[cookiename]) {
      request.language = request.cookies[cookiename];
    }

    i18n.setLocale(request, request.language);
  }
}

// read locale file, translate a msg and write to fs if new

function translate(locale, singular, plural, none) {
  if (locale === undefined) {
    if (debug) {
      console.warn("WARN: No locale found - check the context of the call to $__. Using " + defaultLocale + " (set by request) as current locale");
    }
    locale = defaultLocale;
  }

  if (!locales[locale]) {
    read(locale);
  }

  if (plural) {
    if (!locales[locale][singular]) {
      locales[locale][singular] = {
        'one': singular,
        'other': plural,
        'none': none
      };
      write(locale);
    }
  }

  if (!locales[locale][singular]) {
    locales[locale][singular] = singular;
    write(locale);
  }
  return locales[locale][singular];
}

// try reading a file

function read(locale) {
  var localeFile = {},
      file = locate(locale);

  if (readFcn) {
    locales[locale] = readFcn(locale);
  } else {
    try {
      if (verbose) {
        console.log('read ' + file + ' for locale: ' + locale);
      }
      localeFile = fs.readFileSync(file);
      try {
        // parsing filecontents to locales[locale]
        locales[locale] = JSON.parse(localeFile);
      } catch (parseError) {
        console.error('unable to parse locales from file (maybe ' + file + ' is empty or invalid json?): ', e);
      }
    } catch (readError) {
      // unable to read, so intialize that file
      // locales[locale] are already set in memory, so no extra read required
      // or locales[locale] are empty, which initializes an empty locale.json file
      if (verbose) {
        console.log('initializing ' + file);
      }
    }
    write(locale);
  }
}

// try writing a file in a created directory

function write(locale) {
  var stats, target, tmp;

  // don't write new locale information to disk if updateFiles isn't true
  if (!updateFiles && !writeFcn) {
    return;
  }

 // first time init has an empty file
  if (!locales[locale]) {
    locales[locale] = {};
  }

  if (writeFcn) {
    writeFcn(locale, locales[locale]);
  } else {
    // creating directory if necessary
    try {
      stats = fs.lstatSync(directory);
    } catch (e) {
      if (debug) {
        console.log('creating locales dir in: ' + directory);
      }
      fs.mkdirSync(directory, parseInt('755', 8));
    }

    // writing to tmp and rename on success
    try {
      target = locate(locale);
      tmp = target + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(locales[locale], null, "\t"), "utf8");
      stats = fs.statSync(tmp);
      if (stats.isFile()) {
        fs.renameSync(tmp, target);
      } else {
        console.error('unable to write locales to file (either ' + tmp + ' or ' + target + ' are not writeable?): ', e);
      }
    } catch (e) {
      console.error('unexpected error writing files (either ' + tmp + ' or ' + target + ' are not writeable?): ', e);
    }
  }
}

// basic normalization of filepath

function locate(locale) {
  var ext = extension || '.js';
  return path.normalize(directory + '/' + locale + ext);
}
