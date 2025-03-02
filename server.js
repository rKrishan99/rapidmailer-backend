import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';

dotenv.config();

const app = express();

const PORT = process.env.PORT || 5000;

//middelware
app.use(cors());
app.use(express.json());




//start server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);  
})
