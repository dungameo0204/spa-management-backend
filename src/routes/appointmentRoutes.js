const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);

router.post('/', appointmentController.create);
router.post('/:id/contact-notes', appointmentController.addContactNote);
router.put('/:id/contact-notes/:noteId', appointmentController.updateContactNote);
router.delete('/:id/contact-notes/:noteId', appointmentController.deleteContactNote);
router.get('/', appointmentController.getList);
router.get('/tomorrow', appointmentController.getTomorrow);
router.get('/not-arrived', appointmentController.getNotArrived);
router.get('/:id', appointmentController.getDetail);
router.put('/:id', appointmentController.update);
router.delete('/:id', appointmentController.remove);

module.exports = router;