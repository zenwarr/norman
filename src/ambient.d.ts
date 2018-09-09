declare module "git-url-parse" {
  interface ParsedGitUrl {
    full_name: string;
  }

  function parse(url: string): ParsedGitUrl;

  export = parse;
}
