import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

/** Frequently asked questions about plans, usage and the free trial, from the shared pricing copy. */
export function PricingFaqs({ faqs }: { faqs: Array<{ question: string; answer: string }> }) {
  return (
    <section aria-labelledby="pricing-faq-heading" className="mx-auto max-w-3xl space-y-3">
      <h2 id="pricing-faq-heading" className="text-base font-semibold">
        Frequently asked questions
      </h2>
      <Accordion type="single" collapsible className="w-full">
        {faqs.map((faq, index) => (
          <AccordionItem key={faq.question} value={`faq-${index}`}>
            <AccordionTrigger className="text-left text-sm">{faq.question}</AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{faq.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
