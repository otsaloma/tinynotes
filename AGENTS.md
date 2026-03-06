AGENTS.md
=========

Tiny Notes is a simple note-taking web app that supports bullet-point
notes, collapsible bullets and zoom-in bullets. The app itself is
entirely client-side JavaScript. Sync is provided to AWS S3 via a custom
Lambda function. Tiny Notes is essentially a simplified Workflowy clone.
The main implementation is in files `index.css`, `index.html` and
`index.js`.

## General

* Always run `make check` after your changes
* Don't worry about catching errors (as we have no real users)
* Don't worry about data migrations (as we have no real users)

## CSS

* Indent with two spaces
* Sort attributes in alphabetical order

## JavaScript

* Avoid blank lines inside short functions
* Indent with four spaces
* Minimize the amount of libraries used
* No frameworks!
* Skip curly braces with single-line for and while loops
* Skip parameter parantheses in single-argument arrow functions
* Use const instead of let whenever applicable
* Use double-quotes for strings
* Use template strings instead of plus sign string concatenation
* Use vanilla JavaScript and browser web APIs
* You can use any JavaScript features that run as-is in latest browsers

## HTML

* Assign and use classes for important elements that appear multiple times
* Assign and use ids for important elements that appear only once
* Indent with two spaces

## Python

* Follow PEP8
