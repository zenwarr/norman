# What is it?

A tool that helps to develop multi-package Node.js apps.

# Why not use `npm link` instead?

1. `npm link` is global.
   Anything global is bad (although there are exceptions).
2. In general case, you cannot have `node_modules` directory inside a linked package, because the package does not know it was linked somewhere.
   When the linked package requires another package, it first looks for it in its own `node_modules`, not in `node_modules` of the application it was linked to.
   In most cases it does work, but some packages (especially ones that use singleton instances) are not happy to be imported that way.
3. You develop with packages layout that differs from the layout you application gets when installed in production.
4. Circular linked dependencies is still a pain for many tools.

# How to start?

1. Install: `npm i -g node-norman`
2. Create `.norman.json` configuration file for your application and list modules you want to develop (see below).
4. Run `norman fetch` in in directory where `.norman.json` is located (or give path to config file with `norman --config ~/project/.norman.json fetch`).
5. Norman is going to initialize local modules by cloning source code from repos, optionally making `npm install` and running build commands.

Now you are able to synchronize local modules.
For example, you develop an application in module named `app`, which depends on modules `a` and `b` that you also want to modify.
To start the app, you should have actual versions of modules `a` and `b` in `app/node_modules`.
Without norman you could create symlinks in `app/node_modules` pointing to `a` and `b` source directories.
But with norman you should synchronize `app` module before running.
Synchronizing ensures that you have actual versions of all local dependencies in app directory.
The directory layout matches the one you get by running `npm install` for your module and fetching all dependencies with npm.

To sync a module, run `norman sync app`, where the last argument is either name of the module as specified in the config, or a path to module source directory.

You can use a watcher and synchronize a module on-the-fly by adding `--watch`: `norman sync --watch app`.

Note that norman does not rebuild local modules in watch mode, it only synchronizes files.

But you can rebuild dependent modules on regular sync with `--build-deps` flag.

To sync all local modules at once, use `norman sync-all`.

# `.norman.json` file

All options are documented here.

`modulesDirectory` (string, required): modules listed in `modules` are going to be cloned here by default.

`defaultBranch` (string): default git defaultBranch to use when cloning modules if module defaultBranch is not given explicitly. `master` by default.

`defaultIgnoreOrg` (boolean): if `false`, module `@myorg/repo` is going to be cloned (if `modulesDirectory` is `/home/user/myproject`) as `/home/user/myproject/myorg/repo`.
If `true`, sources are going to be cloned as `/home/user/myproject/repo`.
Default is `false`.

`includeModules` (string or string[]): path (can be relative to the location of current config file) to another config file.
Modules from this config are going to be loaded too (taking into account `modulesDirectory` and other module-affecting options from loaded config).

`defaultNpmIgnore` (string or boolean): by default, any files except those in `.git`, `.idea` and `node_modules` directories are synchronized into app's `node_modules`.
If this option is `true`, `norman` will look for `.npmignore` file in each module, and only synchronize files not ignored by this file.
If `false`, no attempt to use `.npmignore` is done.
If it is a string, a custom file with ignore rules at the given path is going to be used for all modules.
Default is `true`.

`defaultNpmInstall` (boolean): should we make `npm install` in all modules by default.
Default is `true`.

`modules`: list of modules to be cloned from git repositories.
Each item should be an object, properties of this objects are documented below under `module.*` keys.

`module.name` (string): package name (the name the package has in npm registry).
If not specified, the name is deducted from git url in `module.repository`.
If git url is not specified too, error is raised.

`module.repository` (string): url to repository to clone module source from.
If directory where this repository should be cloned already exists, the repository is not going to be cloned.

`module.path` (string): overrides path to cloned repository for the module (deducted by default from `modulesDirectory`).

`module.ignoreOrg` (boolean): overrides value of `defaultIgnoreOrg` for the module.

`module.defaultBranch` (string): overrides default git defaultBranch value from `defaultBranch`.

`module.npmIgnore` (string): overrides `defaultNpmIgnore` value for the module.

`module.npmInstall` (boolean): should we make `npm install` in the module.
Note that build commands are going to be run only if `npm install` is `true`.

`module.buildCommands` (string[]): commands to run during to build the module after cloning it from the repository.
Each command should be either a npm script or a shell command.
Norman first checks if a npm script with given name exists in `package.json` of the local module, and if any, runs it.
If the script is not found, it tries to run it as a shell command.

If the directory where this config is located is itself a npm package (e. g. `package.json` exists), an implicit module is created for this package with name loaded from `package.json` and without a remote repository set.
An implicit module is created only for the directory with main config file (configs loaded with `includeModules` do not create implicit modules).

## Source map support

Norman automatically modifies source map files for JavaScript to always point to original source locations.

## Keeping dependencies up to date

Norman can help you keep dependencies in your modules updated.
To inspect which dependencies need to be updated, run `norman outdated`.
To automatically upgrade all packages to wanted versions (newer versions that still match semver), run `norman outdated --upgrade`.
To upgrade all dependencies to latest versions (note that it overwrites semver ranges specified in `package.json` and can easily break things), run `norman outdated --upgrade --hard`.

By default `outdated` command only analyzes and upgrades modules that were defined in the main config file, and modules loaded by `includeModules` are ignored.
To include all modules, use `--with-included` argument.

# Example config

```json
{
  "modulesDirectory": "/home/user/development/myproject",
  "defaultBranch": "alpha",
  "defaultIgnoreOrg": true,
  "modules": [
    {
      "repository": "git@github.com:zenwarr/norman.git",
      "branch": "alpha"
    }
  ]
}
```

# Troubleshooting

Norman uses local NPM registry server internally that dynamically builds and packs local modules.
The local npm server acts like a proxy to original npm registries and caches tarballs fetched from these registries.
If you have any problems with cached tarballs, run `norman clean cache`.

Norman also stores snapshots of local module state in `~/.norman-state` directory to determine whether it should repack or rebuild requested local module instead of using an already packed version.
You can clean stored state by running `norman clean state`.

To clean everything, including temp files containing packed versions of local modules, run `norman clean all`.
