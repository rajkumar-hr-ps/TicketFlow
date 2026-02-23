import { transferTicket as transferTicketService } from './service.js';
import { EMAIL_RE } from '../../utils/helpers.js';

export const transferTicket = async (req, res) => {
  const ticketId = req.params.id;
  const fromUserId = req.user._id;
  const { to_email } = req.body;

  if (!to_email) {
    return res.status(400).json({ error: 'to_email is required' });
  }

  if (typeof to_email !== 'string' || !EMAIL_RE.test(to_email)) {
    return res.status(400).json({ error: 'invalid email format' });
  }

  const result = await transferTicketService(ticketId, fromUserId, to_email);

  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result.data);
};
