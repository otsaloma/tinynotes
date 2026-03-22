Tiny Notes
==========

Tiny Notes is a simple note-taking web app that supports bullet-point
notes, collapsible bullets and zoom-in bullets. The app itself is
entirely client-side JavaScript. Sync is provided to AWS S3 via a custom
Lambda function. Tiny Notes is essentially a simplified Workflowy clone.

There's no hosted version provided, but Tiny Notes is something you
should be able to easily deploy to your own AWS. It has been designed to
be very cost efficient and shouldn't cost you more than $1/mo to host.

## Local Development

Start a simple web server

```bash
make run
```

and then browse to <http://localhost:8000/?demo=1>. In the demo-mode,
you start every time from an empty set of notes; there's no sync and no
data persistence.

## Deployment

Tiny Notes has been designed to be hosted on AWS, but you can of course
configure equivalent components in some other cloud. You need

* Two S3 buckets
  - One for the web app (public access)
  - One for the notes data (private)
* CloudFront connected to the web app bucket
* Lambda function for the sync
  - Environment variables `ALLOWED_USERS` and `BUCKET`
  - Permissions policy for the execution role to access the data bucket
* Cognito for JWT authentication
  - Configure your preferred authentication methods
  - Configure callback, redirect and sign-out URLs
* API Gateway for access control
  - Add route `/notes` with methods GET, OPTIONS and POST
  - Connect all methods to the Lambda function
  - Connect the Cognito JWT Authorizer for GET and POST (but not OPTIONS!)
  - Configure CORS (and thus no CORS in the Lambda)

Once all that is in place, edit the relevant resource paths etc. into
the constants at the top of the `Makefile` and `index.js`. Then you're
ready to deploy

```bash
make deploy-html
make deploy-lambda
```

## Sync

The Tiny Notes sync has been designed to be reasonably simple and cheap.
Notes are saved as a JSON file in an S3 bucket. Upon page load, the app
fetches the latest notes from the bucket ("get") and after each
modification, limited by debounce, it saves those changes back to S3
("post"). Sync operates always on the full set of notes as one JSON
file. Details and caveats:

* Since notes are synced as one JSON file (instead of a diff), this will
  not work optimally for a very large amount of notes.

* Tiny Notes does not do any merging or conflict resolution, instead
  Tiny Notes uses a running version number and simply refuses posts of
  notes based on an obsolete version. For example, if two devices check
  out notes at the same time and that version is 47, then device A makes
  a post causing the server-side and device A version to be 48. If
  device B then tries to post, the server will refuse that as it's based
  on an obsolete version (47) and will just return HTTP 409 leaving
  device B user to manually sort it out.

* Because of the previous versioning mechanism, Tiny Notes is not
  suitable for multiple users concurrently editing the same notes, but
  should be fine for a single user with multiple devices. The versioning
  should guarantee avoiding data loss surprises, even if in the rare
  cases, the user will need to do some manual resolving.

* By default backups are kept in S3 for the latest 100 versions. In case
  something goes wrong in the sync, you can restore from there using the
  AWS console or aws-cli.
