function requiredEnvironmentVariable(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function firestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(firestoreValue);
  }
  if ("mapValue" in value) {
    return firestoreFields(value.mapValue.fields || {});
  }
  throw new Error("Firestore returned an unsupported field value.");
}

function firestoreFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [name, firestoreValue(value)])
  );
}

function firestoreDocument(document) {
  if (typeof document.name !== "string") {
    throw new Error("Firestore returned a document without a name.");
  }
  const id = decodeURIComponent(document.name.slice(document.name.lastIndexOf("/") + 1));
  return { ...firestoreFields(document.fields || {}), id };
}

async function getFirestoreNews() {
  const apiKey = requiredEnvironmentVariable("FIREBASE_API_KEY", process.env.FIREBASE_API_KEY);
  const projectId = requiredEnvironmentVariable(
    "FIRESTORE_PROJECT_ID",
    process.env.FIRESTORE_PROJECT_ID
  );
  const documents = [];
  const seenTokens = new Set();
  let pageToken;

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/news`
    );
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      throw new Error(`Firestore returned HTTP ${response.status}.`);
    }

    const result = await response.json();
    if (result.documents !== undefined && !Array.isArray(result.documents)) {
      throw new Error("Firestore returned an invalid documents list.");
    }
    documents.push(...(result.documents || []).map(firestoreDocument));

    pageToken = result.nextPageToken || undefined;
    if (pageToken) {
      if (seenTokens.has(pageToken)) {
        throw new Error("Firestore pagination returned a repeated page token.");
      }
      seenTokens.add(pageToken);
    }
  } while (pageToken);

  return documents;
}

function getSiteUrl() {
  const value = requiredEnvironmentVariable("SITE_URL", process.env.SITE_URL);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SITE_URL must be an absolute URL.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("SITE_URL must use HTTPS.");
  }
  return url.origin;
}

module.exports = { getFirestoreNews, getSiteUrl };
