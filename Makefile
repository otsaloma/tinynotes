# -*- coding: utf-8-unix -*-

VERSION = `date +%s`

HTML_S3_TARGET  = s3://otsaloma.io/notes
LAMBDA_NAME     = tinynotes-db
LAMBDA_PLATFORM = aarch64-manylinux_2_34
LAMBDA_REGION   = eu-north-1

check:
	uv run flake8 *.py
	oxlint --deny-warnings *.js

clean:
	rm -rf html
	rm -rf lambda
	rm -f lambda.zip
	rm -f requirements-lambda.txt

# https://docs.aws.amazon.com/lambda/latest/dg/python-package.html
# https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html#runtimes-supported
# https://aws.amazon.com/premiumsupport/knowledge-center/lambda-python-package-compatible/
dist-lambda: check clean
	uv export \
	--no-dev \
	--no-emit-project \
	--output-file requirements-lambda.txt
	uv pip install \
	--python-platform $(LAMBDA_PLATFORM) \
	--python-version 3.14 \
	--target lambda \
	--only-binary :all: \
	-r requirements-lambda.txt
	rm -rf lambda/bin
	rm -f lambda/.lock
	find lambda -name __pycache__ -prune -exec rm -rf {} \;
	cp db.py lambda
	cd lambda && zip -r ../lambda.zip .

deploy-lambda: dist-lambda
	test -f lambda.zip
	aws lambda update-function-code \
	--region $(LAMBDA_REGION) \
	--function-name $(LAMBDA_NAME) \
	--zip-file fileb://lambda.zip

dist-html: check clean
	mkdir html
	cp *.css *.html *.js *.png *.svg html
	sed -ri "s|\?v=dev\"|?v=$(VERSION)\"|g" html/*.html
	! grep "?v=dev" html/*.html
	./bundle-assets.py html/*.html
	rm html/*.css html/*.js

deploy-html: dist-html
	@echo "Uploading HTML files..."
	aws s3 sync html/ $(HTML_S3_TARGET)/ \
	--exclude "*" \
	--include "*.html" \
	--acl public-read \
	--cache-control "public, max-age=3600"
	@echo "Uploading everything else..."
	aws s3 sync html/ $(HTML_S3_TARGET)/ \
	--exclude "*.html" \
	--acl public-read \
	--cache-control "public, max-age=86400"

run:
	uv run python -m http.server

test:
	uv run pytest test_db.py

.PHONY: check clean dist-lambda deploy-lambda dist-html deploy-html run test
