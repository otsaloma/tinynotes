AGENTS.md
=========

Tiny Notes is a simple note-taking web app that supports bullet-point
notes, collapsible bullets and zoom-in bullets. The app itself is
entirely client-side JavaScript, files `index.css`, `index.html` and
`index.js`. Sync is provided to AWS S3 via a custom Lambda function,
file `db.py`. Tiny Notes is essentially a simplified Workflowy clone.

## Demo Mode

Tiny Notes has a demo-mode with URL parameter "demo=1". In demo-mode,
Tiny Notes should never contact the sync server and never save anything
to local storage. Make sure demo-mode remains detached and
non-persistent in all future code changes.

## General

* Always run `make check` after your changes
* Don't worry about catching errors (as we have no real users)
* Don't worry about data migrations (as we have no real users)

## CSS

* Define all colors as variables under :root
* Indent with two spaces
* Minimize the amount of different colors used
* Minimize the amount of different font sizes used
* Prefer setting opacity instead of gray color
* Sort attributes in alphabetical order

## JavaScript

* Avoid blank lines inside short functions
* Indent with four spaces
* Minimize the amount of libraries used
* No frameworks!
* Skip curly braces in single-line for and while loops
* Skip parameter parantheses in single-argument arrow functions
* Use const instead of let whenever applicable
* Use double-quotes for strings
* Use template literal strings instead of string concatenation
* Use vanilla JavaScript and browser web APIs
* You can use any JavaScript features that run as-is in latest browsers

## HTML

* Assign and use classes for important elements that appear multiple times
* Assign and use ids for important elements that appear only once
* Indent with two spaces

## Python

* Follow PEP8
* Use variable name `x` in list comprehensions
* USe variable name `x` in single-argument lambda functions
