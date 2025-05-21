import 'dotenv/config';
import express from "express";
import cors from "cors";
import * as deepl from 'deepl-node';
import multer from 'multer';
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from 'uuid';

// Define __dirname manually for ES modules 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Configure Multer to store uploaded files in an "uploads" directory
const upload = multer({ storage: multer.memoryStorage() });


const app = express(); 
const port = process.env.PORT || 3000;

app.use(cors({ 
  origin: "*", 
  methods: "GET,POST",
  allowedHeaders: "Content-Type",
  exposedHeaders: "Content-Disposition"
}));
app.use(express.json()); 

const DEEPL_API_KEY = process.env.API_KEY;  // Using environment variable for API key
const translator = new deepl.Translator(DEEPL_API_KEY);

app.post("/translate", async (req, res) => {
    try {
        const { text, source_lang, target_lang } = req.body;
        
        // Validate input
        if (!text || !target_lang) {
            return res.status(400).json({ error: "Missing required fields: text or targetLang" });
        }

        let result;
        // Perform translation if source_lang is given
        if (source_lang && source_lang.trim() !== "") {
            result = await translator.translateText(text, source_lang, target_lang);
        } else {
            result = await translator.translateText(text, null, target_lang);
        }

        // Return translated text
        res.json({ translatedText: result.text });
    } catch (error) {
        console.error("Translation Error:", error);
        res.status(500).json({ error: "Failed to translate text" });
    }
});


// Translate Document
app.post("/translate-document", upload.single("file"), async (req, res) => {
  try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const { targetLang } = req.body;
      const options = {filename: req.file.originalname}
      console.log(options)
      console.log(req.file)
      let documentHandle = null;
      // Send file directly to DeepL without saving it
      try{
          documentHandle = await translator.uploadDocument(
          req.file.buffer,  // Pass file as a Buffer
          null,
          targetLang, 
          options  
      );
      }
      catch (err) {
        console.error("DeepL Upload Error:", err.response?.data || err.message);
        return res.status(500).json({ error: "Document upload failed", details: err.response?.data });
    }
      

      console.log("Document Handle:", documentHandle);

      res.json({ 
          document_id: documentHandle.documentId,  
          document_key: documentHandle.documentKey 
      });
  } catch (error) {
      console.error("DeepL Document Translation Error:", error.response?.data || error.message);
      res.status(500).json({ error: "Document translation failed", details: error.response?.data });
  }
});

// Get Document Status
app.post("/get-document-status", async (req, res) => {
    try {
      const { document_id, document_key} = req.body;
      if (!document_id || !document_key) {
        return res.status(400).json({ error: "Missing document_id or document_key" });
    }  
    const documentHandle = {documentId: document_id, documentKey: document_key}
      const status = await translator.getDocumentStatus(documentHandle);
       res.json(status);
    } catch (error) {
      console.error("DeepL Document Status Error:", error);
      res.status(500).json({ error: "Failed to get document status" });
    }
  });

// Download Translated Document
app.post("/download-document", async (req, res) => {
  try {
    const { document_id, document_key, outputFileName } = req.body;
    if (!document_id || !document_key || !outputFileName) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    console.log("Starting document download from DeepL...");
    console.log(`Document ID: ${document_id}, Document Key: ${document_key}`);

    const documentHandle = { documentId: document_id, documentKey: document_key };
    
    // Create a temporary file path
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `${uuidv4()}-${outputFileName}`);
    
    try {
      // Download to temporary file
      console.log(`Downloading to temporary file: ${tempFilePath}`);
      await translator.downloadDocument(documentHandle, tempFilePath);
      
      console.log("Document downloaded successfully. Sending to client...");
      
      // Set headers for file download
      const fileExtension = path.extname(outputFileName).toLowerCase();
      const mimeType = getMimeType(fileExtension);
      res.setHeader("Content-Disposition", `attachment; filename="${outputFileName}"`);
      res.setHeader("Content-Type", mimeType);
      
      // Stream the file to the client
      const fileStream = fs.createReadStream(tempFilePath);
      fileStream.pipe(res);
      
      // Clean up temp file after sending
      fileStream.on('end', () => {
        fs.unlink(tempFilePath, (err) => {
          if (err) console.error(`Error deleting temp file: ${err}`);
          else console.log(`Temporary file deleted: ${tempFilePath}`);
        });
      });
      
      // Handle errors 
      fileStream.on('error', (err) => {
        console.error(`Error streaming file: ${err}`);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        } else {
          res.end();
        }
        
        // Attempt to clean up
        fs.unlink(tempFilePath, () => {});
      });
      
    } catch (downloadError) {
      console.error("DeepL download error:", downloadError);
      // Try to clean up temporary file if it was created
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupError) {
        console.error("Error cleaning up temp file:", cleanupError);
      }
      
      return res.status(500).json({ 
        error: "Download from DeepL failed", 
        details: downloadError.message 
      });
    }

  } catch (error) {
    console.error("Download Error:", error);
    res.status(500).json({ error: "Download failed", details: error.message });
  }
});

// Helper function to determine MIME type based on file extension
function getMimeType(fileExtension) {
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.htm': 'text/html'
  };
  
  return mimeTypes[fileExtension] || 'application/octet-stream';
}




app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
app.get("/", (req, res) => {
    res.send("API läuft");
});