# What is it?

A tool to develop multi-package Node.js apps with ease.

# Why not use `npm link` instead?

1. `npm link` is global.
   Anything global is bad (although there are exceptions).
2. In many cases, you cannot have `node_modules` directory inside a linked package, because the package does not know it was linked somewhere.
   When the linked package requires another package, it looks for it in its own `node_modules`, not in `node_modules` of the package it was linked to.
   Most of the time it works, but some packages (especially ones using singleton instances) are not happy to be imported that way.
3. The layout of the application on development machine differs from the layout of your application in production.
4. Circular linked dependencies is still a pain for many tools.

# How to start?

1. Install: `npm i -g node-norman`
2. Create `.norman.json` config file and list modules you want to develop (see below for format).
4. Run `norman fetch` in the directory where `.norman.json` is located (or give a path to the config with `norman --config ~/project/.norman.json fetch`).
5. Norman is going to initialize local modules by cloning source code from repositories, optionally running `npm install` and build commands.

Now you are able to synchronize local modules.
Imagine you develop three packages: `app`, `a` and `b`, where `app` depends on `a` and `b`.
Before starting `app` you need to have actual versions of `a` and `b` in `app/node_modules`.
Without norman you could create symlinks in `app/node_modules` pointing to `a` and `b` source directories.
But with norman you should synchronize `app` module before running.
Synchronizing `app` guarantees you have actual versions of all packages listed in norman config in `node_modules` of `app`.
The layout of `app/node_modules` after sync matches the one you get by running `npm install` on production and fetching all dependencies by npm.

To sync a module, run `norman sync app`, where the last argument is either name of the module as specified in the config, or a path to the module source directory.

You can use a watcher and synchronize a module on-the-fly by adding `--watch`: `norman sync --watch app`.

Note that norman does not rebuild local modules in watch mode, it only synchronizes changed files.

But you can rebuild dependent modules on regular sync with `--build-deps` flag.

To sync all local modules at once, use `norman sync-all`.

# `.norman.json` file

`modulesDirectory` (string, required): modules listed in `modules` are going to be cloned here by default.

`defaultBranch` (string): default git branch to use when cloning modules if branch is not specified in module config.
Default is `master`.

`defaultIgnoreOrg` (boolean): if `false`, module `@myorg/repo` is going to be cloned (if `modulesDirectory` is `/home/user/my-project`) to `/home/user/myproject/myorg/repo`.
If `true`, sources are going to be cloned to `/home/user/my-project/repo`.
Default is `false`.

`includeModules` (string or string[]): path (can be relative to the location of the current config file) to another config file.
Modules from included configs are loaded too (taking into account `modulesDirectory` and other module-affecting options from included config).

`defaultNpmIgnore` (string or boolean): by default, any files except those in `.git`, `.idea` and `node_modules` directories are synchronized into app's `node_modules`.
If this option is `true`, `norman` looks for `.npmignore` file in each module and only synchronizes files not ignored by this file.
If `false`, no attempt to use `.npmignore` is done.
If it is a string, it specifies path to custom file with ignore rules.
Default is `true`.

`defaultNpmInstall` (boolean): if `true`, run `npm install` in all modules by default.
Default is `true`.

`defaultBuildTriggers` (string[]): list of glob patterns (parsed by minimatch module).
When norman is called with `--build-deps` flag, a module is going to be rebuilt only on changes in files matching these patterns.

`modules`: list of modules to clone from git repositories.
Each item should be an object, properties of these objects are documented below under `module.*` keys.

`module.name` (string): name of the package in npm registry.
If not specified, the name is deducted from git url in `module.repository`.
If git url is not specified, an error is raised.

`module.repository` (string): url to a repository to clone module from.
If destination directory already exists, cloning is skipped.

`module.path` (string): overrides path to the cloned repository for the module (deducted by default from `modulesDirectory`).
Path can be relative to the location of the current config file.

`module.ignoreOrg` (boolean): overrides value of `defaultIgnoreOrg` for the module.

`module.defaultBranch` (string): overrides value of `defaultBranch` for the module.

`module.npmIgnore` (string): overrides value of `defaultNpmIgnore` value for the module.

`module.npmInstall` (boolean): overrides value of `npmInstall` for the module.

`module.buildCommands` (string[]): commands to build the module after cloning it from the repository.
Each command should be either a npm script or a shell command.
Norman first checks if a npm script with the given name exists in `package.json` of the local module and if any, runs it.
If the script is not found, it tries to run it as a shell command.
Ignored if `npmInstall` for the module is `false`.

`module.buildTriggers' (string[]): overrides value of `defaultBuildTriggers` for the module.

## Source map support

Norman automatically modifies JS source maps to reference original source locations.

## Keeping dependencies up to date

Norman can help you keep dependencies in your project updated.
To find outdated dependencies of all modules listed in config, run `norman outdated`.
Run `norman outdated --upgrade` to upgrade all dependencies to newer versions that still match specified semver ranges.
Run `norman outdated -upgrade --hard` to upgrade all dependencies to latest available versions (overwrites semver ranges in `package.json` and can easily break things).

By default `outdated` command does not analyze modules included by `includeModules`.
To include all modules, use `--with-included` flag.

# Example config

```json
{
  "modulesDirectory": "/home/user/development/myproject",
  "defaultBranch": "alpha",
  "defaultIgnoreOrg": true,
  "defaultBuildTriggers": [ "*.ts", "tsconfig.json", "package.json", "webpack.config.js" ],
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
This server acts as a proxy to original npm registries and caches fetched tarballs.
If you have any problems with these cached tarballs, run `norman clean cache`.

Norman also stores snapshots of local module state in `~/.norman-state` directory to determine whether it should repack or rebuild requested local module.
You can clean stored state by running `norman clean state`.

To clean everything including temp files with packed versions of local modules, run `norman clean all`.
