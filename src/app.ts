import packageJson from '../package.json' with { type: 'json' };

const VERSION = packageJson.version;

const HELP = `aspyn
  --help | -h | help | h
  --version | -v | version | v
`;

export function runAspyn(args: string[]): void {
  const command = args[0];

  // TODO: write helper function to check command aliases
  if (
    command === undefined ||
    command === '--help' ||
    command === '-h' ||
    command === 'help' ||
    command === 'h'
  ) {
    console.log(HELP);
    return;
  }

  if (
    command === '--v' ||
    command === '-v' ||
    command === 'version' ||
    command === 'v'
  ) {
    console.log(VERSION);
    return;
  }

  console.log(HELP);
}
