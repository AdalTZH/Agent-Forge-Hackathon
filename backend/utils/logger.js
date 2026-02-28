const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

const timestamp = () => new Date().toISOString().slice(11, 23);

export const logger = {
  info: (tag, msg, data = '') => {
    const extra = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`${COLORS.cyan}[${timestamp()}]${COLORS.reset} ${COLORS.bright}[${tag}]${COLORS.reset} ${msg}${extra}`);
  },
  success: (tag, msg, data = '') => {
    const extra = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`${COLORS.green}[${timestamp()}]${COLORS.reset} ${COLORS.bright}[${tag}]${COLORS.reset} ✓ ${msg}${extra}`);
  },
  warn: (tag, msg) => {
    console.log(`${COLORS.yellow}[${timestamp()}]${COLORS.reset} ${COLORS.bright}[${tag}]${COLORS.reset} ⚠ ${msg}`);
  },
  error: (tag, msg, err = '') => {
    const extra = err ? ` — ${err?.message || err}` : '';
    console.log(`${COLORS.red}[${timestamp()}]${COLORS.reset} ${COLORS.bright}[${tag}]${COLORS.reset} ✗ ${msg}${extra}`);
  },
  phase: (phase) => {
    console.log(`\n${COLORS.magenta}${'═'.repeat(60)}${COLORS.reset}`);
    console.log(`${COLORS.magenta}  PHASE: ${phase.toUpperCase()}${COLORS.reset}`);
    console.log(`${COLORS.magenta}${'═'.repeat(60)}${COLORS.reset}\n`);
  },
};
