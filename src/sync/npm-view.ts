import { LocalModule } from "../local-module";
import { NpmRunner } from "../module-npm-runner";
import * as fs from "fs-extra";
import * as path from "path";
import * as semver from "semver";
import * as chalk from "chalk";
import { getPackageReader } from "../package-reader";


export interface NpmViewInfo {
  isCurrentVersionPublished: boolean;

  /**
   * true if at least one version of this package is published on registry
   */
  isOnRegistry: boolean;
  currentVersion?: string;

  /**
   * Version marked with `latest` dist-tag
   */
  latestTagVersion: string | undefined;

  /**
   * Greatest version (not necessary marked by `latest` tag)
   */
  greatestVersion: string | undefined;

  publishedVersions: string[];
}


async function getNpmViewResult(mod: LocalModule) {
  const output = await NpmRunner.run(mod, [ "view", "--json" ], {
    silent: true,
    collectOutput: true,
    ignoreExitCode: true
  });

  return JSON.parse(output);
}


export function getCurrentPackageVersion(mod: LocalModule): string | undefined {
  let packageJSON = getPackageReader().readPackageMetadata(mod.path);
  if (!packageJSON) {
    return undefined;
  }

  let version = "" + packageJSON.version;
  if (!semver.valid(version)) {
    console.error(chalk.yellow(`Incorrect version for package "${ mod.checkedName.name }": "${ version }", assuming it has no version...`));
    return undefined;
  }

  return version;
}


export async function setPackageVersion(mod: LocalModule, version: string) {
  await NpmRunner.run(mod, [ "version", version, "--no-git-tag-version" ]);
}


export async function getNpmViewInfo(mod: LocalModule): Promise<NpmViewInfo> {
  let currentVersion = getCurrentPackageVersion(mod);

  let packageInfo = await getNpmViewResult(mod);
  if (packageInfo.error != null) {
    if (packageInfo.error.code === "E404") {
      return {
        isCurrentVersionPublished: false,
        isOnRegistry: false,
        currentVersion,
        latestTagVersion: undefined,
        greatestVersion: undefined,
        publishedVersions: []
      };
    } else {
      throw new Error(`Failed to get package information (${ mod.checkedName.name }): ${ packageInfo.error.summary }`);
    }
  }

  let versions = packageInfo.versions;
  if (!versions || !Array.isArray(versions)) {
    throw new Error("No versions found");
  }

  return {
    isCurrentVersionPublished: versions.includes(currentVersion),
    isOnRegistry: true,
    currentVersion,
    latestTagVersion: packageInfo["dist-tags"]?.latestё || undefined,
    greatestVersion: getGreatestVersion(versions) || undefined,
    publishedVersions: versions
  };
}


function getGreatestVersion(versions: string[]) {
  return semver.maxSatisfying(versions, "*");
}
