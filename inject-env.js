// Netlify Environment Variable Injection Script
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'js', 'config.js');

if (!fs.existsSync(configPath)) {
  console.error(`Error: Configuration file not found at ${configPath}`);
  process.exit(1);
}

let configContent = fs.readFileSync(configPath, 'utf8');

// Read from system environment variables (populated by Netlify)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (supabaseUrl && supabaseAnonKey) {
  // Replace the hardcoded URL and Key
  configContent = configContent.replace(
    /const SUPABASE_URL\s*=\s*'.*?';/,
    `const SUPABASE_URL = '${supabaseUrl}';`
  );
  configContent = configContent.replace(
    /const SUPABASE_ANON_KEY\s*=\s*'.*?';/,
    `const SUPABASE_ANON_KEY = '${supabaseAnonKey}';`
  );

  fs.writeFileSync(configPath, configContent, 'utf8');
  console.log('Successfully injected Netlify environment variables into js/config.js');
} else {
  console.log('Netlify environment variables not detected (using local fallback config.js values)');
}
