const multer = require('multer');
const fse = require('fs-extra');

const upload = multer({ dest: 'uploads/' });

const templateUpload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/templates/',
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.docx`),
  }),
  fileFilter: (req, file, cb) => cb(null, /\.docx$/i.test(file.originalname)),
});

fse.ensureDirSync('uploads/templates');

module.exports = { upload, templateUpload };
