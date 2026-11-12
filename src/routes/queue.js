const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const queue = require('../services/queueService');

const router = express.Router();

// Public display board data: ticket numbers and FREE / OCCUPIED only, no patient information.
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json({
      date: queue.currentQueueDate(),
      generatedAt: new Date().toISOString(),
      physicians: await queue.getBoard(),
    });
  }),
);

module.exports = router;
