import json

from django.core.management.base import BaseCommand, CommandError

from paper_optimizer.regression_corpus import build_regression_guardrail_report


class Command(BaseCommand):
    help = 'Benchmark the locked paper optimizer regression corpus.'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true')
        parser.add_argument('--strict', action='store_true')

    def handle(self, *args, **options):
        report = build_regression_guardrail_report()
        results = []
        for item in report['results']:
            comparisons = (item.get('guardrail') or {}).get('comparisons') or {}
            results.append(
                {
                    'case': item['case'],
                    'duration_ms': item['duration_ms'],
                    'selected_plan_code': item['selected_plan_code'],
                    'selected_scenario_code': item['selected_scenario_code'],
                    'engine_fallback_used': item['engine_fallback_used'],
                    'engine_fallback_source': item['engine_fallback_source'],
                    'engine_fallback_reason_code': item['engine_fallback_reason_code'],
                    'feasible_alternative_count': item['feasible_alternative_count'],
                    'no_feasible_candidate': item['no_feasible_candidate'],
                    'total_converted_cost': item['total_converted_cost'],
                    'total_purchase_area': item['total_purchase_area'],
                    'unique_raw_width_count': item['unique_raw_width_count'],
                    'unique_purchase_spec_count': item['unique_purchase_spec_count'],
                    'final_group_count': item['final_group_count'],
                    'technical_waste_rate': item['technical_waste_rate'],
                    'guardrail_passed': bool((item.get('guardrail') or {}).get('passed')),
                    'guardrail_decision_metric': (item.get('guardrail') or {}).get('decision_metric'),
                    'benchmark_compare': comparisons,
                }
            )

        if options['json']:
            self.stdout.write(json.dumps(results, ensure_ascii=False))
        else:
            for result in results:
                self.stdout.write(
                    f"{result['case']}: {result['duration_ms']}ms | "
                    f"plan={result['selected_plan_code']} | "
                    f"scenario={result['selected_scenario_code']} | "
                    f"fallback={result['engine_fallback_used']} | "
                    f"feasible={result['feasible_alternative_count']} | "
                    f"no_feasible={result['no_feasible_candidate']} | "
                    f"guardrail={'PASS' if result['guardrail_passed'] else 'FAIL'}"
                )

        if options['strict'] and not report['passed']:
            failing_cases = ', '.join(
                f"{item['case']}:{item['decision_metric']}"
                for item in report['failing_cases']
            )
            raise CommandError(f'Paper optimizer benchmark guardrail failed: {failing_cases}')
