# cleaner-spec-reporter

[![Version](https://img.shields.io/npm/v/clean-spec-reporter.svg)](https://npm.im/clean-spec-reporter)
[![Dependencies](https://img.shields.io/librariesio/release/npm/clean-spec-reporter)](https://libraries.io/npm/clean-spec-reporter)
[![Build](https://github.com/ShogunPanda/clean-spec-reporter/workflows/CI/badge.svg)](https://github.com/ShogunPanda/clean-spec-reporter/actions?query=workflow%3ACI)
[![Coverage](https://img.shields.io/codecov/c/gh/ShogunPanda/clean-spec-reporter?token=wUfs01bBGb)](https://codecov.io/gh/ShogunPanda/clean-spec-reporter)

A cleaner version of the `spec` reporter of the [Node.js test runner](https://nodejs.org/dist/latest/docs/api/test.html).

http://sw.cowtech.it/clean-spec-reporter

## Usage

clean-spec-reporter allows to add coloring to terminal in a really easy way.

Just run your test by specifying it as your test report:

```bash
node --test --test-reporter=cleaner-spec-reporter ...
```

## ESM Only

This package only supports to be directly imported in a ESM context.

For informations on how to use it in a CommonJS context, please check [this page](https://gist.github.com/ShogunPanda/fe98fd23d77cdfb918010dbc42f4504d).

## Contributing to clean-spec-reporter

- Check out the latest master to make sure the feature hasn't been implemented or the bug hasn't been fixed yet.
- Check out the issue tracker to make sure someone already hasn't requested it and/or contributed it.
- Fork the project.
- Start a feature/bugfix branch.
- Commit and push until you are happy with your contribution.
- Make sure to add tests for it. This is important so I don't break it in a future version unintentionally.

## Copyright

Copyright (C) 2025 and above Shogun (shogun@cowtech.it).

Licensed under the ISC license, which can be found at https://choosealicense.com/licenses/isc.
