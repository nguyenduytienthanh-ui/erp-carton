# GL ViewSets - to be appended to finance/views.py


# ============== GENERAL LEDGER ==============
class GeneralLedgerAccountViewSet(viewsets.ModelViewSet):
    """Chart of Accounts Management"""
    queryset = GeneralLedgerAccount.objects.all()
    serializer_class = GeneralLedgerAccountSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['account_type', 'is_active']
    search_fields = ['code', 'name']
    ordering_fields = ['code', 'created_at']
    ordering = ['code']
    permission_classes = [IsAuthenticated]


class GeneralLedgerViewSet(viewsets.ReadOnlyModelViewSet):
    """General Ledger Entries - Read-only"""
    serializer_class = GeneralLedgerEntrySerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['account', 'posting_date', 'document_type']
    search_fields = ['document_code', 'description', 'account__code', 'account__name']
    ordering_fields = ['posting_date', 'created_at']
    ordering = ['-posting_date', '-id']
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        return GeneralLedgerEntry.objects.select_related("account", "created_by").all()
    
    @action(detail=False, methods=["get"])
    def trial_balance(self, request):
        """Get trial balance - sum by account"""
        from django.db.models import Sum
        from decimal import Decimal
        
        date_from = request.query_params.get("date_from")
        date_to = request.query_params.get("date_to")
        
        queryset = GeneralLedgerEntry.objects.all()
        if date_from:
            queryset = queryset.filter(posting_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(posting_date__lte=date_to)
        
        accounts = GeneralLedgerAccount.objects.filter(is_active=True)
        data = []
        total_debit = Decimal(0)
        total_credit = Decimal(0)
        
        for account in accounts:
            entries = queryset.filter(account=account)
            debit = entries.aggregate(Sum("debit_amount"))["debit_amount__sum"] or Decimal(0)
            credit = entries.aggregate(Sum("credit_amount"))["credit_amount__sum"] or Decimal(0)
            
            if debit > 0 or credit > 0:
                data.append({
                    "account_code": account.code,
                    "account_name": account.name,
                    "account_type": account.account_type,
                    "debit": str(debit),
                    "credit": str(credit),
                })
                total_debit += debit
                total_credit += credit
        
        data.append({
            "account_code": "TOTAL",
            "account_name": "TỔNG CỘNG",
            "account_type": "",
            "debit": str(total_debit),
            "credit": str(total_credit),
        })
        
        return Response(data)
    
    @action(detail=False, methods=["get"])
    def account_balance(self, request):
        """Get balance for specific account"""
        from django.db.models import Sum
        from decimal import Decimal
        
        account_id = request.query_params.get("account_id")
        date_to = request.query_params.get("date_to")
        
        if not account_id:
            return Response({"error": "account_id required"}, status=400)
        
        queryset = GeneralLedgerEntry.objects.filter(account_id=account_id)
        if date_to:
            queryset = queryset.filter(posting_date__lte=date_to)
        
        debit_total = queryset.aggregate(Sum("debit_amount"))["debit_amount__sum"] or Decimal(0)
        credit_total = queryset.aggregate(Sum("credit_amount"))["credit_amount__sum"] or Decimal(0)
        balance = debit_total - credit_total
        
        return Response({
            "debit_total": str(debit_total),
            "credit_total": str(credit_total),
            "balance": str(balance),
        })
