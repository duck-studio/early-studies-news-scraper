import fs from 'fs';
import path from 'path';

// Get input file path from command line arguments
const args = process.argv.slice(2); // Skip the first two elements (node executable and script path)
if (args.length !== 1) {
  console.error('Usage: bun src/scripts/extract_headlines.ts <input_json_file_path>');
  // Or using the package.json script: bun run extract:headlines <input_json_file_path>
  process.exit(1);
}

const inputFilePath = args[0];
const outputFileName = `extracted_${path.basename(inputFilePath, '.json')}.txt`;
const outputFilePath = path.join(process.cwd(), outputFileName); // Save in the current working directory

try {
  // Ensure the input file exists
  if (!fs.existsSync(inputFilePath)) {
    throw new Error(`Input file not found: ${inputFilePath}`);
  }

  // Read the JSON file
  const jsonData = fs.readFileSync(inputFilePath, 'utf8');

  // Parse the JSON data
  const data = JSON.parse(jsonData);

  // Basic validation for the expected structure
  if (!data || !data.data || !Array.isArray(data.data.results)) {
    throw new Error('Invalid JSON structure. Expected { data: { results: [...] } }');
  }

  const results = data.data.results;

  // Extract headlines and snippets
  const outputLines = results.map((item: { headline: string; snippet: string }) => {
    // Use 'any' for simplicity, or define an interface
    const headline = item.headline || 'No Headline';
    const snippet = item.snippet || 'No Snippet';
    // Ensure headline and snippet are strings and replace newlines within them
    const cleanHeadline = String(headline).replace(/(\r\n|\n|\r)/gm, ' ');
    const cleanSnippet = String(snippet).replace(/(\r\n|\n|\r)/gm, ' ');
    return `${cleanHeadline}\n${cleanSnippet}\n\n`; // Add two newlines for separation
  });

  // Join all lines into one giant string
  const outputText = outputLines.join('');

  // Write the combined text to the output file
  fs.writeFileSync(outputFilePath, outputText, 'utf8');

  console.log(`Successfully extracted headlines and snippets to ${outputFilePath}`);
} catch (error: unknown) {
  // Catch specific error types if needed
  if (error instanceof Error) {
    console.error('Error processing the file:', error.message);
  } else {
    console.error('Error processing the file:', String(error));
  }
  process.exit(1); // Exit with an error code
}
