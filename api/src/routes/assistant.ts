import { Router } from 'express';
import { query } from '../db';
import { AssistantAuthError, resolveAssistantCaller, AssistantQueryFn } from '../assistant/context';
import { assistantProviderFromEnv, AssistantProvider } from '../assistant/provider';
import { parseAssistantInput, runAssistant } from '../assistant/service';

export function createAssistantRouter(options: {
  provider?: AssistantProvider;
  queryFn?: AssistantQueryFn;
} = {}) {
  const router = Router();
  const queryFn = options.queryFn || query;
  const provider = options.provider || assistantProviderFromEnv();

  router.post('/', async (req, res) => {
    try {
      const input = parseAssistantInput(req.body);
      const caller = await resolveAssistantCaller(req, queryFn);
      const result = await runAssistant(input, caller, provider, queryFn);

      res.json({
        role: result.role,
        response: result.response
      });
    } catch (err) {
      if (err instanceof AssistantAuthError) {
        res.status(err.status).json({ error: err.message });
        return;
      }

      if (err instanceof Error && (err.message === 'message is required' || err.message === 'message is too long')) {
        res.status(400).json({ error: err.message });
        return;
      }

      console.error(err);
      res.status(500).json({ error: 'could not run the assistant' });
    }
  });

  return router;
}

export default createAssistantRouter();
