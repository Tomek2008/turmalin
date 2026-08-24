from rest_framework.response import Response
from rest_framework.decorators import api_view

@api_view(['GET'])
def data_insight(request):
    return Response({
        "status": "Optimal",
        "nodes_connected": 25420,
        "threat_level": "Low",
        "active_anomalies": 2,
        "message": "Palantir core systems online."
    })
