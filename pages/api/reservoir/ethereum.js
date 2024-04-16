import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const handler = async (req, res) => {
  // Define a function to append logs to a file for debugging
  const logToFile = (message) => {
    const logDirectory = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDirectory)){
      fs.mkdirSync(logDirectory);
    }
    const logFilePath = path.join(logDirectory, 'debug.log');
    try {
      fs.appendFileSync(logFilePath, `${new Date().toISOString()} - ${message}\n`);
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  };

  // Log the incoming request
  console.log(`Incoming request: ${req.method} ${req.url} - Body: ${JSON.stringify(req.body)} - Query: ${JSON.stringify(req.query)}`);
  logToFile(`Incoming request: ${req.method} ${req.url} - Body: ${JSON.stringify(req.body)} - Query: ${JSON.stringify(req.query)}`);

  // Check if the endpoint is provided in the query, if not log an error
  if (!req.query.endpoint) {
    const errorMessage = 'No endpoint specified in the query: ' + JSON.stringify(req.query);
    console.error(errorMessage);
    logToFile(errorMessage);
    res.status(400).json({ message: 'No endpoint specified in the query' });
    return;
  }

  // Construct the full endpoint URL
  const endpoint = `${process.env.NEXT_PUBLIC_RESERVOIR_BASE_URL}/${req.query.endpoint}`;
  console.log(`Constructed endpoint URL: ${endpoint}`);
  logToFile(`Constructed endpoint URL: ${endpoint}`);

  try {
    // Perform the API request
    const apiResponse = await fetch(endpoint, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.RESERVOIR_API_KEY,
      },
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    });

    // Log the API response
    const apiResponseText = await apiResponse.text();
    console.log(`API Response: ${apiResponse.status} - ${apiResponse.statusText} - Body: ${apiResponseText}`);
    logToFile(`API Response: ${apiResponse.status} - ${apiResponse.statusText} - Body: ${apiResponseText}`);

    // Check if the API response is ok
    if (!apiResponse.ok) {
      throw new Error(`API responded with status: ${apiResponse.status}`);
    }

    // Parse the response and send it back to the client
    const data = JSON.parse(apiResponseText);
    res.status(200).json(data);
  } catch (error) {
    // Log and respond with the error
    console.error(`Error handling request: ${error.message}`);
    logToFile(`Error handling request: ${error.message}`);
    res.status(500).json({ message: error.message });
  }
};

// Add a console log to output the absolute path of the debug.log file
console.log(`Log file path: ${path.join(__dirname, 'logs', 'debug.log')}`);

export default handler;
