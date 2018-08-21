# What is it?

An extensible tool that helps to develop multi-package Node.js apps.

# Why not use `npm link` instead?

1. `npm link` is global.
   Anything global is bad (although there are exceptions).
2. In general case, you cannot have `node_modules` directory inside a linked package, because the package does not know it was linked somewhere.
   When the linked package requires another package, it first looks for it in its own `node_modules`, not in `node_modules` of the application it was linked to.
   In most cases it does work, but some packages (especially ones that use singleton instances) are not happy to be imported that way.

# How does it work?

1. Install: `npm i -g node-norman`
2. Create `.norman.json` configuration file for your application and list modules you want to develop (see below).
3. Run `npm install` in your application home directory.
4. Run `norman` in in directory where `.norman.json` is located.
5. Norman will clone source code from repos, optionally making `npm install` for cloned sources and running build commands.
6. Cloned sources are going to be relinked: if a cloned module `A` has a dependency on another cloned module `B`, the installed copy of `B` in `A/node_modules/B` is going to be replaced with soft link to `B`.
7. Cloned modules are synchronized into `node_modules` of your application.
  Files are not soft- or hard-linked, but copied into `APP/node_modules`.
  Only modules that already exists in app's `node_modules` are going to be synchronized.
8. Cloned modules are watched for changes, changes in non-ignored files are synchronized into `APP/node_modules`.

# `.norman.json` file

All options are documented here.

`modulesDirectory` (string, required): modules listed in `modules` are going to be cloned here by default.

`defaultBranch` (string): default git branch to use when cloning modules if module branch is not given explicitly. `master` by default.

`defaultIgnoreOrg` (boolean): if `false`, module `@myorg/repo` is going to be cloned (if `modulesDirectory` is `/home/user/myproject`) as `/home/user/myproject/myorg/repo`.
If `true`, sources are going to be cloned as `/home/user/myproject/repo`.
Default is `false`.

`installMissingAppDeps` (boolean). When you do `npm install --save` in any module being watched, `norman` detects it and checks dependencies of your module for conflicts with modules installed into application `node_modules` directory.
If the package you added to your module is not installed in app `node_modules`, `norman` will try to install it (dependency is not going to be saved into app `package.json`), but only if `installMissingAppDeps` is `true`.

`plugins` (string[]): list of plugins to be loaded.
If the plugin is published as `node-norman-some-plugin` on `npm`, you should add `some-plugin` to this list (but if plugin is published in npm organization, or it is a local file, specify a full name).

`includeModules` (string or string[]): path (can be relative to the location of current config file) to another config file.
Modules from this config are going to be loaded too (taking into account `modulesDirectory` and other module-affecting options from loaded config).

`defaultNpmIgnore` (string or boolean): by default, any files except those in `.git`, `.idea` and `node_modules` directories are synchronized into app's `node_modules`.
If this option is `true`, `norman` will look for `.npmignore` file in each module, and only synchronize files not ignored by this file.
If `false`, no attempt to use `.npmignore` is done.
If it is a string, a custom file with ignore rules at the given path is going to be used for all modules.
Default is `true`.

`modules`: list of modules to be cloned from git repositories.
Each item should be an object, properties of this objects are documented below under `module.*` keys.

`module.repository` (string): url to repository to clone module source from.
This field is required.
Package name is deducted from the path.
If directory where this repository should be cloned already exists, the repository is not going to be cloned.

`module.path` (string): overrides path to cloned repository for the module (deducted by default from `modulesDirectory`).

`module.ignoreOrg` (boolean): overrides value of `defaultIgnoreOrg` for the module.

`module.branch` (string): overrides default git branch value from `defaultBranch`.

`module.npmIgnore` (string): overrides `defaultNpmIgnore` value for the module.

`module.relink` (boolean): if `false`, do not relink another packages into this module's `node_modules`.

`app` (object): Object containing app configuration.
Its properties are documented below under `app.*` keys.

`app.home` (string): optional, path to directory of application home (where app `package.json` lives).
If empty, the directory with `.norman.json` file is used.

`app.forceModules` (string[]): by default, `norman` synchronizes only modules that were already installed into app `node_modules` during initial `npm install`).
You can list any module here to synchronize it regardless of directory existence.

# Example config

```json
{
  "modulesDirectory": "/home/user/development/myproject",
  "defaultBranch": "alpha",
  "defaultIgnoreOrg": true,
  "installMissingAppDeps": true,
  "plugins": [
    "coffee-script"
  ],
  "modules": [
    {
      "repository": "git@github.com:zenwarr/norman.git",
      "branch": "alpha"
    }
  ],
  "app": {
    "home": "/home/user/apps/myproject"
  }
}
```

# Source map support

By default, `norman` transforms source maps it synchronizes to point to locations in your source code directory.

# Plugins

Currently there is only one plugin, `node-norman-coffee-script`.
It transpiles `.coffee` files on-the-fly (you are going to have `.coffee` files in source directory and compiled `.js` and `js.map` files in `APP/node_modules` (coffee 1.x is used).

# Command-line interface reference

`--config`: Path to config file or a directory containing config file named `.norman.json`.
`--watch`: Watches for changes in local modules and automatically synchronizes all modules.
`sync ~/projects/myapp/moduleA`
`sync ~/projects/myapp/moduleA --build-deps`
