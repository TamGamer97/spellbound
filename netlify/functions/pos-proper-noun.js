// Netlify Function: POS-based proper noun detection using wink-pos-tagger
const winkPosTagger = require('wink-pos-tagger');
const tagger = winkPosTagger();

exports.handler = async (event) => {
  try {
    const word = (event.queryStringParameters && event.queryStringParameters.word) || '';
    const trimmed = String(word).trim();
    if (!trimmed) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'word query parameter is required', isProperNoun: false }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    const tokens = tagger.tagSentence(trimmed);
    const isProperNoun = tokens.some((t) => t.pos === 'NNP' || t.pos === 'NNPS');

    return {
      statusCode: 200,
      body: JSON.stringify({ isProperNoun }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal error', isProperNoun: false }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};

// Netlify Function: POS-based proper noun detection using wink-pos-tagger
const winkPosTagger = require('wink-pos-tagger');
const tagger = winkPosTagger();

exports.handler = async (event) => {
  try {
    const word = (event.queryStringParameters && event.queryStringParameters.word) || '';
    const trimmed = String(word).trim();
    if (!trimmed) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'word query parameter is required', isProperNoun: false }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    const tokens = tagger.tagSentence(trimmed);
    const isProperNoun = tokens.some((t) => t.pos === 'NNP' || t.pos === 'NNPS');

    return {
      statusCode: 200,
      body: JSON.stringify({ isProperNoun }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal error', isProperNoun: false }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};

// Netlify Function: POS-based proper noun detection using wink-pos-tagger
const winkPosTagger = require('wink-pos-tagger');
const tagger = winkPosTagger();

exports.handler = async (event) => {
  try {
    const word = (event.queryStringParameters && event.queryStringParameters.word) || '';
    const trimmed = String(word).trim();
    if (!trimmed) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'word query parameter is required', isProperNoun: false }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    const tokens = tagger.tagSentence(trimmed);
    const isProperNoun = tokens.some((t) => t.pos === 'NNP' || t.pos === 'NNPS');

    return {
      statusCode: 200,
      body: JSON.stringify({ isProperNoun }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal error', isProperNoun: false }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};

