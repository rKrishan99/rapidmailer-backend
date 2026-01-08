import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';

import googleMapsRoute  from './src/routes/googleMapsRoute.js';
import emailExtractorRoute from './src/routes/emailExtractorRoute.js'
import emailVerifyRoute from './src/routes/emailVerifyRouter.js'
import emailSendRoute from './src/routes/emailSendRoute.js';

dotenv.config();

const app = express();

const PORT = process.env.PORT || 5000;

//middelware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', googleMapsRoute);
app.use('/api', emailExtractorRoute);
app.use('/api', emailVerifyRoute);
app.use('/api', emailSendRoute);


//start server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);  
})
