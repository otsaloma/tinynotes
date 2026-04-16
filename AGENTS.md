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

## Scope

Assume Tiny Notes would only be used for a small to moderate amount of
notes. As a rough guideline, you can assume less than one hundred
thousand bullets and less than one megabyte size for the synced
`notes.json` file. You can assume all notes fit just fine both in memory
and in the DOM.

## General

* Always run `direnv exec . make check` after your changes
* Always run `direnv exec . make test` after editing `db.py`
* Don't worry about catching errors (as we have no real users)
* Don't worry about data migrations (as we have no real users)

## Git

Start your commit message title with an appropriate verb like "Add",
"Fix" or "Refactor" that describes the nature of the change. When fixing
an issue, always explain both the problem and the fix in the commit
message. When executing git to make a commit, always use the shell
heredoc ("<<EOF") syntax for your commit message and wrap lines at 72
characters. If fixing something related to a previous commit, always
reference that previous commit in the message by its commit hash.
When making a commit, always add yourself as Co-Authored-By, including
your model name and version, example:
`Co-Authored-By: ACME Transformer 1.2 <noreply@acme.com>`.

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
* Skip parameter parentheses in single-argument arrow functions
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
* Use variable name `x` in single-argument lambda functions
