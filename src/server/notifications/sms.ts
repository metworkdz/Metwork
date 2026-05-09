/**
 * SMS/WhatsApp transport via Infobip.
 * Re-exports the Infobip client functions for use by the notification dispatcher.
 * Twilio has been removed; Infobip is the sole SMS/WhatsApp provider.
 */
export { sendWhatsAppOTP, sendSMSOTP } from '@/lib/infobip';
