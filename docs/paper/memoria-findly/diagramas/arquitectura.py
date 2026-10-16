from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.cost import Budgets
from diagrams.aws.database import Dynamodb
from diagrams.aws.integration import Eventbridge
from diagrams.aws.management import Cloudwatch
from diagrams.aws.ml import Rekognition
from diagrams.aws.network import APIGateway, CloudFront
from diagrams.aws.security import Cognito
from diagrams.aws.storage import S3
from diagrams.onprem.client import User

graph_attr = {"dpi": "200", "pad": "0.5", "nodesep": "0.7", "ranksep": "1.0"}

with Diagram(
    "Arquitectura de Findly",
    filename="img/arquitectura",
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=graph_attr,
):
    asistente = User("Asistente")
    organizador = User("Organizador")

    with Cluster("AWS Cloud"):
        with Cluster("Frontend"):
            cdn = CloudFront("CloudFront")
            web = S3("S3 web\n(React + Vite)")

        cognito = Cognito("Cognito")
        apigw = APIGateway("API Gateway HTTP")
        api = Lambda("Lambda API")
        db = Dynamodb("DynamoDB\non-demand")

        with Cluster("Datos privados"):
            selfies = S3("S3 selfies")
            fotos = S3("S3 fotos")

        inscripcion = Lambda("Lambda\ninscripción")
        matching = Lambda("Lambda\nmatching")
        rek = Rekognition("Rekognition")

        with Cluster("Retención"):
            scheduler = Eventbridge("EventBridge\nScheduler")
            retencion = Lambda("Lambda\nretención")

        with Cluster("Observabilidad y coste"):
            cw = Cloudwatch("CloudWatch")
            budgets = Budgets("AWS Budgets")

    asistente >> cdn
    organizador >> cdn
    cdn >> web
    organizador >> Edge(label="login") >> cognito
    asistente >> apigw
    organizador >> apigw
    apigw >> api
    api >> db
    api >> Edge(label="URLs prefirmadas") >> selfies
    api >> Edge(label="URLs prefirmadas") >> fotos

    selfies >> inscripcion >> rek
    fotos >> matching >> rek
    inscripcion >> db
    matching >> db

    scheduler >> retencion
    retencion >> selfies
    retencion >> fotos
    retencion >> rek

    api >> Edge(style="dotted") >> cw
    budgets - Edge(style="dotted") - cw
