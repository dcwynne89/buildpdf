// Health check endpoint for API monitoring (e.g., RapidAPI)
// Returns 200 OK with basic status information

exports.handler = async (event) => {
  // Only allow GET
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({
      status: "healthy",
      service: "BuildPDF API",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    }),
  };
};
