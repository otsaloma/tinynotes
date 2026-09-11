# AGENTS.md

## Scope

Assume Tiny Notes would only be used for a small to moderate amount of
notes. As a rough guideline, you can assume less than one hundred
thousand bullets and less than one megabyte size for the synced
`notes.json` file. You can assume all notes fit just fine both in memory
and in the DOM.

## General

- Always run `direnv exec . make check` after your changes
- Always run `direnv exec . make test` after editing `db.py`
- Don't add defensive try/catch (as we have no real users)
- Don't worry about data migrations (as we have no real users)

## Demo Mode

Tiny Notes has a demo-mode with URL parameter `demo=1`. In demo-mode,
Tiny Notes should never contact the sync server and never save anything
to local storage. Make sure demo-mode remains detached and
non-persistent in all future code changes.

## CSS

- Add a comment for non-obvious selectors, such as `.text:empty::before`
- Add a comment when using `calc` in a non-obvious way
- Define all colors as variables under :root
- Minimize the number of distinct colors used
- Minimize the number of distinct font sizes used
- Prefer setting opacity instead of gray color
- Sort attributes in alphabetical order

## JavaScript

- Avoid blank lines inside short functions
- No frameworks! No libraries!
- Skip curly braces in single-line for and while loops
- Skip parameter parentheses in single-argument arrow functions
- You can use any JavaScript features that run as-is in latest browsers
