/** Builder estimate request status labels and pipeline order. */

export const ESTIMATE_STATUS_PIPELINE = ['pending', 'reviewing', 'quoted', 'won', 'lost'];

export const ESTIMATE_STATUS_LABELS = {
 pending: 'Submitted',
 reviewing: 'Under review',
 in_review: 'Under review',
 quoted: 'Quote sent',
 won: 'Accepted',
 lost: 'Declined',
 closed: 'Declined',
 new_lead: 'Received',
};

export function normalizeEstimateStatus(status) {
 const s = String(status || 'pending').toLowerCase();
 if (s === 'in_review') return 'reviewing';
 if (s === 'closed') return 'lost';
 return s;
}

export function estimateStatusLabel(status) {
 const key = normalizeEstimateStatus(status);
 return ESTIMATE_STATUS_LABELS[key] || ESTIMATE_STATUS_LABELS[status] || status || 'Unknown';
}
