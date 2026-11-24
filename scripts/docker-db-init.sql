-- Executed once by the postgres container on first start.
create database dressit_test;
create role dressit_app login password 'dressit_app_dev';
grant connect on database dressit to dressit_app;
grant connect on database dressit_test to dressit_app;
