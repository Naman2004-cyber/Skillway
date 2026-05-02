const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/academic_tracker').then(async () => {
    const Message = mongoose.model('Message', new mongoose.Schema({}, { strict: false }));
    const msg = await Message.findOne({ attachments: { $exists: true, $not: {$size: 0} } }).sort({ createdAt: -1 });
    console.log(JSON.stringify(msg, null, 2));
    process.exit(0);
});
