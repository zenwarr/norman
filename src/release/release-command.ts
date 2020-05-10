import { getArgs } from "../arguments";
import { ReleaseType } from "./release-types";
import { getCwdModule } from "../cwd-module";
import { LocalModule } from "../local-module";
import * as chalk from "chalk";
import { shutdown } from "../shutdown";
import { getCurrentPackageVersion, setPackageVersion } from "../sync/npm-view";
import * as semver from "semver";
import { runCommand } from "../utils";


function getNewReleaseVersion(mod: LocalModule, releaseType: ReleaseType) {
  let currentVersion = getCurrentPackageVersion(mod);
  if (!currentVersion) {
    throw new Error("No version specified");
  }

  switch (releaseType) {
    case ReleaseType.Major:
      return semver.inc(currentVersion, "premajor");

    case ReleaseType.Minor:
      return semver.inc(currentVersion, "preminor");

    case ReleaseType.Patch:
    case ReleaseType.Hotfix:
      return semver.inc(currentVersion, "prepatch");
  }
}


async function checkoutReleaseBranch(mod: LocalModule, version: string) {
  let coerced = semver.coerce(version)!.version;
  let args = [ "checkout", "-b", coerced ];
  await runCommand("git", args);
}


export async function releaseCommand() {
  let args = getArgs();

  if (args.subCommand !== "release") {
    throw new Error("Expected release");
  }

  let mod = getCwdModule();
  if (!mod.useNpm) {
    console.error(chalk.red(`Cannot release current module: does not use npm`));
    shutdown(-1);
  }

  if (args.releaseCommand === "begin") {
    let version = getNewReleaseVersion(mod, args.beginReleaseType)!;
    await checkoutReleaseBranch(mod, version);
    await setPackageVersion(mod, version);
  } else if (args.releaseCommand === "end") {
    let currentVersion = getCurrentPackageVersion(mod);
    // we do not merge branch into parent here, because:
    // 1. we have no reliable way to find parent branch
    // 2. we do not want to deal with merge conflicts here.
    let coerced = semver.coerce(currentVersion)?.version!;
    await setPackageVersion(mod, coerced);
  }
}
