import { Router } from 'express';
import { withTransaction } from '../db';
import { establishPasswordWithToken, PasswordSetupError } from '../passwordSetup';

const router = Router();

router.post('/setup-password', async (req, res) => {
  try {
    await withTransaction(
      (client) => establishPasswordWithToken(client, req.body ? req.body.token : undefined, req.body ? req.body.password : undefined),
      { isolationLevel: 'serializable' }
    );

    res.json({ password_set: true });
  } catch (err) {
    if (err instanceof PasswordSetupError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    if ((err as { code?: string }).code === '40001') {
      res.status(409).json({ error: 'password setup conflict, please retry' });
      return;
    }

    console.error(err);
    res.status(500).json({ error: 'could not set password' });
  }
});

export default router;
