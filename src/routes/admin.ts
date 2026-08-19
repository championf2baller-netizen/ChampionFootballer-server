import Router from 'koa-router';
import { required } from '../modules/auth';
import { upload } from '../middleware/upload';
import {
  requireAdmin,
  getAllStaticContentAdmin,
  upsertStaticContentAdmin,
  deleteStaticContentAdmin,
  uploadStaticImageAdmin,
  getPublicStaticContent,
  ensureDefaultsExist
} from '../controllers/adminStaticController';

// Run database schema migration & admin seeding on server start
ensureDefaultsExist().catch((err) => console.error('Admin migration startup error:', err));

const router = new Router();

// Public REST Endpoints (for Mobile App & Web App)
router.get('/api/static-content', getPublicStaticContent);
router.get('/api/static-content/:key', getPublicStaticContent);

// Super Admin Protected Endpoints
router.get('/api/admin/static-content', required, requireAdmin, getAllStaticContentAdmin);
router.post('/api/admin/static-content/upload-image', required, requireAdmin, upload.single('image'), uploadStaticImageAdmin);
router.post('/api/admin/static-content', required, requireAdmin, upsertStaticContentAdmin);
router.patch('/api/admin/static-content/:key', required, requireAdmin, upsertStaticContentAdmin);
router.delete('/api/admin/static-content/:key', required, requireAdmin, deleteStaticContentAdmin);

export default router;
