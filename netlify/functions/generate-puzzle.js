const { generateSinglePuzzle } = require("../../scripts/v2/index.js");

exports.handler = async function (event) {
  // Allow only POST to avoid accidental crawlers hitting generation.
  if (event.httpMethod && event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Allow": "POST" },
      body: "Method Not Allowed",
    };
  }

  try {
    const puzzle = await generateSinglePuzzle();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(puzzle),
    };
  } catch (err) {
    console.error("generate-puzzle error", err && err.message ? err.message : err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Puzzle generation failed" }),
    };
  }
}

